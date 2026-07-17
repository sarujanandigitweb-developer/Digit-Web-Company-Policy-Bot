import { sql } from "@/lib/db/client.server";
import { NotFound } from "@/lib/http/errors";

/**
 * Read-only views over what the chatbot actually did.
 *
 * Conversations are anonymous: the chat has no login, so chat_sessions.user_id
 * is null and these are browsed by department and date rather than by person.
 */

export interface ConversationSummary {
  id: string;
  department_id: string | null;
  department_name: string | null;
  is_global_search: boolean;
  title: string | null;
  message_count: number;
  avg_confidence: number | null;
  avg_response_ms: number | null;
  started_at: string;
  last_message_at: string | null;
}

export interface ListConversationsQuery {
  page: number;
  pageSize: number;
  search?: string;
  departmentId?: string;
  from?: string;
  to?: string;
  sortBy?: string;
  sortDir?: "asc" | "desc";
}

/** Allowlisted sort columns — ORDER BY cannot be a bound parameter. */
const SORT_SQL: Record<string, string> = {
  started: "s.started_at",
  activity: "s.last_message_at",
  messages: "message_count",
  confidence: "avg_confidence",
  department: "dep.name",
};

export async function list(
  query: ListConversationsQuery,
): Promise<{ items: ConversationSummary[]; total: number }> {
  const offset = (query.page - 1) * query.pageSize;
  const search = query.search ?? null;
  const orderColumn = SORT_SQL[query.sortBy ?? "activity"] ?? SORT_SQL.activity;
  const orderDir = query.sortDir === "asc" ? "ASC" : "DESC";

  const rows = (await sql`
    SELECT s.id, s.department_id, dep.name AS department_name, s.is_global_search,
           s.title, s.started_at, s.last_message_at,
           count(m.id)::int AS message_count,
           -- Averaged over assistant turns only: user messages carry no score.
           avg(m.confidence_score) FILTER (WHERE m.role = 'assistant') AS avg_confidence,
           avg(m.responded_in_ms) FILTER (WHERE m.role = 'assistant') AS avg_response_ms,
           count(*) OVER()::int AS total_count
      FROM chat_sessions s
      LEFT JOIN departments dep ON dep.id = s.department_id
      LEFT JOIN chat_messages m ON m.session_id = s.id
     WHERE (${search}::text IS NULL
              OR s.title ILIKE '%' || ${search} || '%'
              -- Search the transcript, not just the title: admins look for a
              -- question they were told about, which is rarely the title.
              OR EXISTS (SELECT 1 FROM chat_messages cm
                          WHERE cm.session_id = s.id AND cm.content ILIKE '%' || ${search} || '%'))
       AND (${query.departmentId ?? null}::uuid IS NULL
              OR s.department_id = ${query.departmentId ?? null}::uuid)
       AND (${query.from ?? null}::date IS NULL OR s.started_at >= ${query.from ?? null}::date)
       -- The "to" bound covers the whole day, which is what a date picker implies.
       AND (${query.to ?? null}::date IS NULL
              OR s.started_at < (${query.to ?? null}::date + interval '1 day'))
     GROUP BY s.id, dep.name
     ORDER BY ${sql.unsafe(orderColumn)} ${sql.unsafe(orderDir)} NULLS LAST, s.id
     LIMIT ${query.pageSize} OFFSET ${offset}
  `) as Array<ConversationSummary & { total_count: number }>;

  const items = rows.map(({ total_count: _t, ...row }) => ({
    ...row,
    avg_confidence: row.avg_confidence === null ? null : Number(row.avg_confidence),
    avg_response_ms: row.avg_response_ms === null ? null : Number(row.avg_response_ms),
  }));
  return { items, total: rows[0]?.total_count ?? 0 };
}

export interface Citation {
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

export interface TranscriptMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  confidence_score: number | null;
  responded_in_ms: number | null;
  created_at: string;
  citations: Citation[];
}

export interface ConversationDetail extends ConversationSummary {
  messages: TranscriptMessage[];
}

export async function getById(id: string): Promise<ConversationDetail> {
  const sessions = (await sql`
    SELECT s.id, s.department_id, dep.name AS department_name, s.is_global_search,
           s.title, s.started_at, s.last_message_at,
           (SELECT count(*) FROM chat_messages m WHERE m.session_id = s.id)::int AS message_count,
           (SELECT avg(confidence_score) FROM chat_messages m
             WHERE m.session_id = s.id AND m.role = 'assistant') AS avg_confidence,
           (SELECT avg(responded_in_ms) FROM chat_messages m
             WHERE m.session_id = s.id AND m.role = 'assistant') AS avg_response_ms
      FROM chat_sessions s
      LEFT JOIN departments dep ON dep.id = s.department_id
     WHERE s.id = ${id}::uuid
  `) as ConversationSummary[];

  const session = sessions[0];
  if (!session) throw NotFound("Conversation not found");

  const messages = (await sql`
    SELECT id, role, content, confidence_score, responded_in_ms, created_at
      FROM chat_messages
     WHERE session_id = ${id}::uuid
     ORDER BY created_at
  `) as Array<Omit<TranscriptMessage, "citations">>;

  // One query for every citation in the conversation rather than one per
  // message: a 20-turn transcript would otherwise be 20 round trips.
  const citations = (await sql`
    SELECT mc.message_id, mc.chunk_id, mc.rank, mc.similarity,
           c.heading, c.page_number, c.content,
           d.id AS document_id, d.title AS document_title, dep.name AS department_name
      FROM message_citations mc
      JOIN chat_messages m ON m.id = mc.message_id
      JOIN knowledge_chunks c ON c.id = mc.chunk_id
      JOIN knowledge_documents d ON d.id = c.document_id
      JOIN departments dep ON dep.id = c.department_id
     WHERE m.session_id = ${id}::uuid
     ORDER BY mc.rank
  `) as Array<Citation & { message_id: string }>;

  const byMessage = new Map<string, Citation[]>();
  for (const { message_id, ...citation } of citations) {
    const list = byMessage.get(message_id) ?? [];
    list.push({ ...citation, similarity: Number(citation.similarity) });
    byMessage.set(message_id, list);
  }

  return {
    ...session,
    avg_confidence: session.avg_confidence === null ? null : Number(session.avg_confidence),
    avg_response_ms: session.avg_response_ms === null ? null : Number(session.avg_response_ms),
    messages: messages.map((m) => ({
      ...m,
      confidence_score: m.confidence_score === null ? null : Number(m.confidence_score),
      citations: byMessage.get(m.id) ?? [],
    })),
  };
}
