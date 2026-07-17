import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowLeft, Bug, ChevronDown, FileText, MessagesSquare } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { api } from "@/lib/api/client";
import { CARD, TILE_GRADIENT } from "@/components/admin/theme";
import { EmptyState, ErrorState, LoadingBlock } from "@/components/admin/states";
import { ConfidencePill } from "@/components/admin/confidence-pill";

export const Route = createFileRoute("/admin/conversations/$id")({
  component: ConversationDetailPage,
});

interface Citation {
  chunk_id: string;
  rank: number;
  similarity: number;
  heading: string | null;
  page_number: number | null;
  content: string;
  document_id: string;
  document_title: string;
  department_name: string;
}

interface TranscriptMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  confidence_score: number | null;
  responded_in_ms: number | null;
  created_at: string;
  citations: Citation[];
}

interface ConversationDetail {
  id: string;
  department_name: string | null;
  is_global_search: boolean;
  title: string | null;
  message_count: number;
  avg_confidence: number | null;
  avg_response_ms: number | null;
  started_at: string;
  messages: TranscriptMessage[];
}

function ConversationDetailPage() {
  const { id } = Route.useParams();

  const conversation = useQuery({
    queryKey: ["conversation", id],
    queryFn: () => api.get<ConversationDetail>(`/api/admin/conversations/${id}`),
  });

  if (conversation.isLoading) return <LoadingBlock label="Loading transcript…" />;
  if (conversation.isError) {
    return (
      <div className="mx-auto max-w-[1000px] space-y-4">
        <BackLink />
        <div className={CARD}>
          <ErrorState error={conversation.error} onRetry={() => conversation.refetch()} />
        </div>
      </div>
    );
  }

  const c = conversation.data!;

  return (
    <div className="mx-auto w-full max-w-[1000px] space-y-6">
      <BackLink />

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            {c.title || "Untitled conversation"}
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {c.is_global_search ? "All departments" : (c.department_name ?? "No department")} ·{" "}
            {c.message_count} messages · {new Date(c.started_at).toLocaleString()}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500">Avg. confidence</span>
          <ConfidencePill value={c.avg_confidence} />
        </div>
      </header>

      {c.messages.length === 0 ? (
        <div className={CARD}>
          <EmptyState icon={MessagesSquare} title="No messages in this conversation" />
        </div>
      ) : (
        <div className="space-y-4">
          {c.messages.map((message) =>
            message.role === "user" ? (
              <UserTurn key={message.id} message={message} />
            ) : (
              <AssistantTurn key={message.id} message={message} conversation={c} />
            ),
          )}
        </div>
      )}
    </div>
  );
}

/** Mirrors the chat's own user bubble so a transcript reads like the real thing. */
function UserTurn({ message }: { message: TranscriptMessage }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[80%]">
        <div
          className="rounded-2xl rounded-tr-md px-4 py-2.5 text-sm text-white shadow-md"
          style={{ background: TILE_GRADIENT }}
        >
          {message.content}
        </div>
        <p className="mt-1 text-right text-[11px] tabular-nums text-slate-400">
          {new Date(message.created_at).toLocaleTimeString()}
        </p>
      </div>
    </div>
  );
}

function AssistantTurn({
  message,
  conversation,
}: {
  message: TranscriptMessage;
  conversation: ConversationDetail;
}) {
  return (
    <div className="flex gap-3">
      <div
        className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-xs font-black text-white shadow"
        style={{ background: TILE_GRADIENT }}
        aria-hidden="true"
      >
        D
      </div>

      <div className={`${CARD} min-w-0 flex-1 p-4`}>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <ConfidencePill value={message.confidence_score} />
          {message.responded_in_ms !== null && (
            <span className="text-[11px] tabular-nums text-slate-400">
              {(message.responded_in_ms / 1000).toFixed(1)}s
            </span>
          )}
          <span className="text-[11px] tabular-nums text-slate-400">
            {new Date(message.created_at).toLocaleTimeString()}
          </span>
        </div>

        <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700 dark:text-slate-200">
          {message.content}
        </p>

        {message.citations.length > 0 && <CitationViewer citations={message.citations} />}

        <DebugPanel message={message} conversation={conversation} />
      </div>
    </div>
  );
}

/** The chunks that actually produced this answer, from message_citations. */
function CitationViewer({ citations }: { citations: Citation[] }) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="mt-3">
      <CollapsibleTrigger className="flex w-full items-center gap-1.5 rounded border-t border-slate-100 pt-3 text-xs font-medium text-slate-600 transition hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2b6cf3] dark:border-white/10 dark:text-slate-300 dark:hover:text-white">
        <FileText className="h-3.5 w-3.5" />
        {citations.length} retrieved chunk{citations.length === 1 ? "" : "s"}
        <ChevronDown
          className={`ml-auto h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 space-y-2">
        {citations.map((citation) => (
          <div
            key={citation.chunk_id}
            className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-white/10 dark:bg-white/5"
          >
            <div className="mb-1.5 flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold text-slate-800 dark:text-slate-100">
                  [{citation.rank}] {citation.heading ?? citation.document_title}
                </p>
                <Link
                  to="/admin/knowledge/$id"
                  params={{ id: citation.document_id }}
                  className="truncate rounded text-[11px] text-slate-500 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2b6cf3] dark:text-slate-400"
                >
                  {citation.document_title} · {citation.department_name}
                  {citation.page_number !== null && ` · page ${citation.page_number}`}
                </Link>
              </div>
              <span className="shrink-0 rounded-md bg-slate-900 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-white dark:bg-white dark:text-slate-900">
                {citation.similarity.toFixed(3)}
              </span>
            </div>
            <p className="max-h-28 overflow-y-auto whitespace-pre-wrap text-[11px] leading-relaxed text-slate-600 dark:text-slate-300">
              {citation.content}
            </p>
          </div>
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * Debug retrieval.
 *
 * The prompt is RECONSTRUCTED, not replayed: prompts are assembled per request
 * and never stored, so this rebuilds it from the recorded citations using the
 * same layout chat-knowledge.server.ts uses. It is faithful for the excerpt
 * block — which is the part that decides the answer — and is labelled as
 * reconstructed rather than presented as a captured artefact.
 *
 * The query embedding is likewise not stored: it is 1536 floats per message and
 * deterministic from the question, so the question is shown instead.
 */
function DebugPanel({
  message,
  conversation,
}: {
  message: TranscriptMessage;
  conversation: ConversationDetail;
}) {
  const [open, setOpen] = useState(false);

  const question =
    conversation.messages
      .filter((m) => m.role === "user" && m.created_at <= message.created_at)
      .at(-1)?.content ?? "(not found)";

  const excerpts = message.citations
    .map((c) => {
      const location = [c.heading, c.page_number !== null ? `page ${c.page_number}` : null]
        .filter(Boolean)
        .join(", ");
      return `[${c.rank}] ${c.document_title}${location ? ` — ${location}` : ""} (${c.department_name})\n${c.content.trim()}`;
    })
    .join("\n\n");

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="mt-3">
      <CollapsibleTrigger className="flex w-full items-center gap-1.5 rounded border-t border-slate-100 pt-3 text-xs font-medium text-slate-500 transition hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2b6cf3] dark:border-white/10 dark:text-slate-400 dark:hover:text-white">
        <Bug className="h-3.5 w-3.5" />
        Debug retrieval
        <ChevronDown
          className={`ml-auto h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 space-y-3">
        <DebugField label="Question (embedded as the retrieval query)" value={question} />
        <DebugField
          label="Scope"
          value={
            conversation.is_global_search
              ? "Global — all departments"
              : `Department — ${conversation.department_name ?? "none"}`
          }
        />
        <DebugField
          label="Retrieved chunks & similarity"
          value={
            message.citations.length === 0
              ? "(none retrieved)"
              : message.citations
                  .map((c) => `[${c.rank}] ${c.similarity.toFixed(4)}  ${c.document_title}`)
                  .join("\n")
          }
        />
        <DebugField
          label="Prompt excerpts (reconstructed from citations — prompts are not stored)"
          value={excerpts || "(no excerpts)"}
          scroll
        />
        <DebugField label="Final answer" value={message.content} scroll />
      </CollapsibleContent>
    </Collapsible>
  );
}

function DebugField({
  label,
  value,
  scroll = false,
}: {
  label: string;
  value: string;
  scroll?: boolean;
}) {
  return (
    <div>
      <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <pre
        className={`overflow-x-auto whitespace-pre-wrap rounded-xl bg-slate-900 p-3 font-mono text-[11px] leading-relaxed text-slate-100 dark:bg-black/40 ${
          scroll ? "max-h-48 overflow-y-auto" : ""
        }`}
      >
        {value}
      </pre>
    </div>
  );
}

function BackLink() {
  return (
    <Link
      to="/admin/conversations"
      className="inline-flex items-center gap-1.5 rounded text-sm text-slate-500 transition hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2b6cf3] dark:text-slate-400 dark:hover:text-white"
    >
      <ArrowLeft className="h-4 w-4" />
      Back to Conversations
    </Link>
  );
}
