import { useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Loader2, ScanSearch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api, ApiError } from "@/lib/api/client";
import { CARD } from "./theme";

/** Shapes returned by GET /api/admin/knowledge/conflict-scan. */
export interface ScanSide {
  chunk_id: string;
  document_id: string;
  title: string;
  department: string;
  heading: string | null;
  page_number: number | null;
  content: string;
}
export interface ScanFinding {
  relation: "conflict" | "uncertain" | "overlap" | "duplicate";
  explanation: string;
  a: ScanSide;
  b: ScanSide;
}
export interface ScanStatus {
  scan: {
    id: string;
    status: "running" | "complete";
    cursor_chunk_id: string | null;
    chunks_total: number;
    chunks_done: number;
    started_at: string;
    completed_at: string | null;
  } | null;
  findings: ScanFinding[];
  counts: Record<string, number>;
}

const GROUPS: Array<{ relation: ScanFinding["relation"]; title: string; hint: string }> = [
  {
    relation: "conflict",
    title: "Conflicts",
    hint: "Incompatible claims about the same scope. Needs a policy owner's decision.",
  },
  {
    relation: "uncertain",
    title: "Uncertain",
    hint: "Not enough context to classify reliably, or the comparison could not run.",
  },
  {
    relation: "overlap",
    title: "Partly repeated",
    hint: "Shared wording plus additional facts. Check that the extra detail agrees.",
  },
  {
    relation: "duplicate",
    title: "Duplicates",
    hint: "The same rule in two places. Keep one canonical source.",
  },
];

/**
 * Admin-only panel. The scan runs one passage per request so progress is visible
 * and a closed tab loses nothing: completed comparisons are stored. Nothing here
 * changes a document or what the chatbot can retrieve.
 */
export function ConflictScanPanel({ canScan }: { canScan: boolean }) {
  const qc = useQueryClient();
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  // A ref, not state: a double-click must not start a second loop before the first re-renders.
  const runningRef = useRef(false);

  const status = useQuery({
    queryKey: ["conflict-scan"],
    queryFn: () => api.get<ScanStatus>("/api/admin/knowledge/conflict-scan"),
    enabled: canScan,
  });

  async function run() {
    if (runningRef.current) return;
    runningRef.current = true;
    setRunning(true);
    setMessage(null);
    try {
      const started = await api.post<{ id: string }>("/api/admin/knowledge/conflict-scan", {
        action: "start",
      });
      let current = await api.get<ScanStatus>(
        `/api/admin/knowledge/conflict-scan?scanId=${started.id}`,
      );
      if (!current.scan) throw new Error("No scan was created");
      const scanId = current.scan.id;
      let cursor = current.scan.cursor_chunk_id;
      for (;;) {
        const step = await api.post<{ done: boolean; cursor: string | null }>(
          "/api/admin/knowledge/conflict-scan",
          { action: "step", scanId, cursor },
        );
        cursor = step.cursor;
        current = await api.get<ScanStatus>(`/api/admin/knowledge/conflict-scan?scanId=${scanId}`);
        setProgress({
          done: current.scan?.chunks_done ?? 0,
          total: current.scan?.chunks_total ?? 0,
        });
        qc.setQueryData(["conflict-scan"], current);
        if (step.done) break;
      }
      setMessage("Scan complete. Review the results below.");
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setMessage("The scan moved on in another window. Refresh and continue.");
      } else {
        setMessage("The scan stopped before finishing. Run it again to resume.");
      }
      void qc.invalidateQueries({ queryKey: ["conflict-scan"] });
    } finally {
      runningRef.current = false;
      setRunning(false);
    }
  }

  if (!canScan) return null;
  if (status.isError) {
    return (
      <section className={`${CARD} p-5`}>
        <p className="text-sm text-slate-500">The conflict scan is unavailable right now.</p>
      </section>
    );
  }
  if (!status.data) return null;

  return (
    <ConflictScanView
      data={status.data}
      running={running}
      progress={progress}
      message={message}
      onStart={run}
    />
  );
}

/** Presentational half: no network calls, so it can be rendered directly. */
export function ConflictScanView({
  data,
  running,
  progress,
  message,
  onStart,
}: {
  data: ScanStatus;
  running: boolean;
  progress: { done: number; total: number } | null;
  message: string | null;
  onStart: () => void;
}) {
  const scan = data.scan;
  const done = progress?.done ?? scan?.chunks_done ?? 0;
  const total = progress?.total ?? scan?.chunks_total ?? 0;
  const percent = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;

  return (
    <section className={`${CARD} space-y-4 p-5`} aria-labelledby="conflict-scan-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2
            id="conflict-scan-heading"
            className="text-sm font-semibold text-slate-900 dark:text-white"
          >
            Library conflict scan
          </h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Compares active passages with related passages in the same or shared departments.
            Read-only: scanning changes nothing. Each finding is resolved in the review of the
            document that owns the passage, where an authorized reviewer makes an explicit decision.
          </p>
        </div>
        <Button size="sm" className="h-9 gap-2" onClick={onStart} disabled={running}>
          {running ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <ScanSearch className="h-3.5 w-3.5" />
          )}
          {running ? "Scanning…" : scan?.status === "running" ? "Resume scan" : "Scan library"}
        </Button>
      </div>

      {scan && (
        <div className="space-y-1.5">
          <div className="flex justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>
              {scan.status === "complete" ? "Last scan complete" : "Scan in progress"} · {done} of{" "}
              {total} passages checked
            </span>
            <span>{percent}%</span>
          </div>
          <div
            className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            aria-label="Conflict scan progress"
          >
            <div className="h-full bg-[#2b6cf3] transition-all" style={{ width: `${percent}%` }} />
          </div>
        </div>
      )}

      {message && <p className="text-xs text-slate-600 dark:text-slate-300">{message}</p>}

      {!scan && (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          No scan has run yet. Start one to check the library for conflicts and duplicates.
        </p>
      )}

      {data.findings.length === 0 && scan?.status === "complete" && (
        <p className="flex items-center gap-2 text-xs text-emerald-700 dark:text-emerald-300">
          <CheckCircle2 className="h-4 w-4" /> No conflicts, uncertain passages or duplicates were
          found.
        </p>
      )}

      {GROUPS.map((group) => {
        const items = data.findings.filter((f) => f.relation === group.relation);
        if (items.length === 0) return null;
        return (
          <div key={group.relation} className="space-y-2">
            <h3 className="flex items-center gap-2 text-xs font-semibold text-slate-800 dark:text-slate-100">
              {group.relation === "conflict" && (
                <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
              )}
              {group.title} ({items.length})
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">{group.hint}</p>
            <ul className="space-y-3">
              {items.map((finding) => (
                <FindingCard
                  key={`${finding.a.chunk_id}-${finding.b.chunk_id}`}
                  finding={finding}
                />
              ))}
            </ul>
          </div>
        );
      })}
    </section>
  );
}

function FindingCard({ finding }: { finding: ScanFinding }) {
  return (
    <li className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
      <p className="text-xs text-slate-600 dark:text-slate-300">{finding.explanation}</p>
      <div className="mt-2 grid gap-3 md:grid-cols-2">
        <SourceSide label="Source A" side={finding.a} />
        <SourceSide label="Source B" side={finding.b} />
      </div>
    </li>
  );
}

function SourceSide({ label, side }: { label: string; side: ScanSide }) {
  const location = [side.heading, side.page_number !== null ? `page ${side.page_number}` : null]
    .filter(Boolean)
    .join(", ");
  return (
    <div className="min-w-0 rounded-lg bg-slate-50 p-2.5 dark:bg-slate-900/60">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-0.5 truncate text-xs font-medium text-slate-900 dark:text-white">
        {side.title}
        <span className="font-normal text-slate-500"> · {side.department}</span>
      </p>
      {location && <p className="text-[11px] text-slate-500">{location}</p>}
      <p className="mt-1.5 line-clamp-4 whitespace-pre-line text-xs text-slate-700 dark:text-slate-300">
        {side.content}
      </p>
      <Link
        to="/admin/knowledge/$id"
        params={{ id: side.document_id }}
        hash="content-review"
        className="mt-2 inline-block text-xs font-medium text-[#2b6cf3] hover:underline"
      >
        Resolve in this document's review
      </Link>
    </div>
  );
}
