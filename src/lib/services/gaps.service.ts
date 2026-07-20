import { sql, withTransaction } from "@/lib/db/client.server";
import { write as writeAudit } from "@/lib/audit/log.server";
import type { SessionUser } from "@/lib/auth/session.server";
import { BadRequest, NotFound } from "@/lib/http/errors";

/**
 * Knowledge gaps — questions the bot could not answer confidently.
 *
 * Rows are written by the chat pipeline (chat-knowledge.server.ts), which
 * collapses near-identical repeats into occurrence_count. This module is the
 * review workflow over them.
 */

export type GapStatus = "pending" | "reviewed" | "resolved" | "ignored";

export interface KnowledgeGap {
  id: string;
  question: string;
  department_id: string | null;
  department_name: string | null;
  confidence_score: number;
  ai_response: string | null;
  status: GapStatus;
  occurrence_count: number;
  last_asked_at: string;
  reviewed_by: string | null;
  reviewer_name: string | null;
  reviewed_at: string | null;
  resolution_note: string | null;
  resolved_document_id: string | null;
  resolved_document_title: string | null;
  session_id: string | null;
  created_at: string;
}

export interface ListGapsQuery {
  page: number;
  pageSize: number;
  search?: string;
  departmentId?: string;
  status?: GapStatus;
  /** Inclusive date bounds (YYYY-MM-DD) on last_asked_at. */
  from?: string;
  to?: string;
  sortBy?: string;
  sortDir?: "asc" | "desc";
}

const SORT_SQL: Record<string, string> = {
  frequency: "g.occurrence_count",
  last_asked: "g.last_asked_at",
  confidence: "g.confidence_score",
  department: "dep.name",
  status: "g.status",
};

export async function list(
  query: ListGapsQuery,
): Promise<{ items: KnowledgeGap[]; total: number }> {
  const offset = (query.page - 1) * query.pageSize;
  const search = query.search ?? null;
  // Most-asked first by default: frequency is what decides which policy to write.
  const orderColumn = SORT_SQL[query.sortBy ?? "frequency"] ?? SORT_SQL.frequency;
  const orderDir = query.sortDir === "asc" ? "ASC" : "DESC";

  const rows = (await sql`
    SELECT g.id, g.question, g.department_id, dep.name AS department_name,
           g.confidence_score, g.ai_response, g.status, g.occurrence_count,
           g.last_asked_at, g.reviewed_by, p.full_name AS reviewer_name, g.reviewed_at,
           g.resolution_note, g.resolved_document_id, kd.title AS resolved_document_title,
           g.session_id, g.created_at,
           count(*) OVER()::int AS total_count
      FROM knowledge_gaps g
      LEFT JOIN departments dep ON dep.id = g.department_id
      LEFT JOIN profiles p ON p.user_id = g.reviewed_by
      LEFT JOIN knowledge_documents kd ON kd.id = g.resolved_document_id
     WHERE (${search}::text IS NULL OR g.question ILIKE '%' || ${search} || '%')
       AND (${query.departmentId ?? null}::uuid IS NULL
              OR g.department_id = ${query.departmentId ?? null}::uuid)
       AND (${query.status ?? null}::gap_status IS NULL
              OR g.status = ${query.status ?? null}::gap_status)
       AND (${query.from ?? null}::date IS NULL OR g.last_asked_at >= ${query.from ?? null}::date)
       -- 'to' is inclusive of the whole day, so compare against the next midnight.
       AND (${query.to ?? null}::date IS NULL
              OR g.last_asked_at < (${query.to ?? null}::date + interval '1 day'))
     ORDER BY ${sql.unsafe(orderColumn)} ${sql.unsafe(orderDir)} NULLS LAST, g.id
     LIMIT ${query.pageSize} OFFSET ${offset}
  `) as Array<KnowledgeGap & { total_count: number }>;

  const items = rows.map(({ total_count: _t, ...row }) => ({
    ...row,
    confidence_score: Number(row.confidence_score),
  }));
  return { items, total: rows[0]?.total_count ?? 0 };
}

export async function getById(id: string): Promise<KnowledgeGap> {
  const { items } = await list({ page: 1, pageSize: 1, search: undefined });
  void items;
  const rows = (await sql`
    SELECT g.*, dep.name AS department_name, p.full_name AS reviewer_name,
           kd.title AS resolved_document_title
      FROM knowledge_gaps g
      LEFT JOIN departments dep ON dep.id = g.department_id
      LEFT JOIN profiles p ON p.user_id = g.reviewed_by
      LEFT JOIN knowledge_documents kd ON kd.id = g.resolved_document_id
     WHERE g.id = ${id}::uuid
  `) as KnowledgeGap[];
  if (!rows[0]) throw NotFound("Knowledge gap not found");
  return { ...rows[0], confidence_score: Number(rows[0].confidence_score) };
}

export interface UpdateGapInput {
  question?: string;
  departmentId?: string | null;
  status?: GapStatus;
  resolutionNote?: string | null;
  resolvedDocumentId?: string | null;
}

/** Bulk-deletes gaps. Returns how many rows were removed. */
export async function deleteMany(
  ids: string[],
  actor: SessionUser,
  request: Request,
): Promise<number> {
  return withTransaction(async (tx) => {
    const { rows } = await tx.query(
      `DELETE FROM knowledge_gaps WHERE id = ANY($1::uuid[]) RETURNING id`,
      [ids],
    );
    const deletedIds = rows.map((r) => r.id as string);
    if (deletedIds.length > 0) {
      await writeAudit(tx, {
        actor,
        action: "gap.deleted",
        table: "knowledge_gaps",
        recordId: deletedIds.length === 1 ? deletedIds[0] : `${deletedIds.length} gaps`,
        oldValue: { count: deletedIds.length, ids: deletedIds },
        request,
      });
    }
    return deletedIds.length;
  });
}

/**
 * Updates a gap's review state.
 *
 * Stamps reviewer and time whenever the status moves off 'pending', so the
 * trail records who triaged it — not just that someone did.
 */
export async function update(
  id: string,
  input: UpdateGapInput,
  actor: SessionUser,
  request: Request,
): Promise<KnowledgeGap> {
  if (input.resolvedDocumentId) {
    const doc = (await sql`
      SELECT 1 FROM knowledge_documents WHERE id = ${input.resolvedDocumentId}::uuid
    `) as unknown[];
    if (doc.length === 0) throw BadRequest("The linked document does not exist");
  }

  await withTransaction(async (tx) => {
    const before = await tx.query(`SELECT * FROM knowledge_gaps WHERE id = $1::uuid FOR UPDATE`, [
      id,
    ]);
    if (!before.rowCount) throw NotFound("Knowledge gap not found");
    const current = before.rows[0] as { status: GapStatus };

    const nextStatus = input.status ?? current.status;
    const isTriaged = nextStatus !== "pending";

    const { rows } = await tx.query(
      `UPDATE knowledge_gaps SET
         question = COALESCE($9, question),
         department_id = CASE WHEN $10::bool THEN $11::uuid ELSE department_id END,
         status = $2::gap_status,
         resolution_note = CASE WHEN $3::bool THEN $4 ELSE resolution_note END,
         resolved_document_id = CASE WHEN $5::bool THEN $6::uuid ELSE resolved_document_id END,
         reviewed_by = CASE WHEN $7::bool THEN $8::uuid ELSE reviewed_by END,
         reviewed_at = CASE WHEN $7::bool THEN now() ELSE reviewed_at END
       WHERE id = $1::uuid
       RETURNING *`,
      [
        id,
        nextStatus,
        Object.prototype.hasOwnProperty.call(input, "resolutionNote"),
        input.resolutionNote ?? null,
        Object.prototype.hasOwnProperty.call(input, "resolvedDocumentId"),
        input.resolvedDocumentId ?? null,
        isTriaged,
        actor.userId,
        input.question ?? null,
        Object.prototype.hasOwnProperty.call(input, "departmentId"),
        input.departmentId ?? null,
      ],
    );

    await writeAudit(tx, {
      actor,
      action: nextStatus === "resolved" ? "gap.resolved" : "gap.reviewed",
      table: "knowledge_gaps",
      recordId: id,
      oldValue: { status: current.status },
      newValue: { status: rows[0].status, resolution_note: rows[0].resolution_note },
      request,
    });
  });

  return getById(id);
}

export interface GapStats {
  pending: number;
  reviewed: number;
  resolved: number;
  ignored: number;
  total_occurrences: number;
}

export async function stats(): Promise<GapStats> {
  const rows = (await sql`
    SELECT count(*) FILTER (WHERE status = 'pending')::int  AS pending,
           count(*) FILTER (WHERE status = 'reviewed')::int AS reviewed,
           count(*) FILTER (WHERE status = 'resolved')::int AS resolved,
           count(*) FILTER (WHERE status = 'ignored')::int  AS ignored,
           COALESCE(sum(occurrence_count) FILTER (WHERE status = 'pending'), 0)::int
             AS total_occurrences
      FROM knowledge_gaps
  `) as GapStats[];
  return rows[0];
}
