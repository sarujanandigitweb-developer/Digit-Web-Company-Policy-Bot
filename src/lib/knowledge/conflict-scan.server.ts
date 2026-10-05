import { sql, withTransaction } from "@/lib/db/client.server";
import type { SessionUser } from "@/lib/auth/session.server";
import { write as writeAudit } from "@/lib/audit/log.server";
import { Conflict, NotFound } from "@/lib/http/errors";
import { classifyPassage } from "./classify.server";
import { KNOWLEDGE_WRITE_LOCK } from "./review.server";
import type { ReviewMatch } from "./review-policy";

/**
 * Library-wide conflict scan over active, searchable knowledge.
 *
 * Read-only with respect to knowledge: it never changes a chunk, a document's
 * status or what the chatbot can retrieve. It only records what it found in
 * knowledge_pair_comparisons, so a reviewer can see both sources side by side and
 * decide through the existing per-document review, which is the only path that
 * changes published content.
 *
 * One active passage is compared per step, so a single request never holds a
 * model call for the whole library. Every pair is stored once, which both
 * deduplicates findings and lets an interrupted scan resume without repeating work.
 */

const FINDING_RELATIONS = ["conflict", "uncertain", "overlap", "duplicate"] as const;

interface ScanRow {
  id: string;
  status: "running" | "complete";
  cursor_chunk_id: string | null;
  chunks_total: number;
  chunks_done: number;
  started_at: string;
  completed_at: string | null;
}

/** Starts a scan, or returns the one already running. Starting twice never creates two. */
export async function startScan(actor: SessionUser, request: Request): Promise<{ id: string }> {
  return withTransaction(async (tx) => {
    await tx.query(`SELECT pg_advisory_xact_lock($1)`, [KNOWLEDGE_WRITE_LOCK]);
    const running = await tx.query(
      `SELECT id FROM knowledge_conflict_scans WHERE status='running'
       ORDER BY started_at DESC LIMIT 1 FOR UPDATE`,
    );
    if (running.rows[0]) return { id: running.rows[0].id as string };

    const total = await tx.query(
      `SELECT count(*)::int AS n FROM knowledge_chunks c
         JOIN knowledge_documents d ON d.id = c.document_id
        WHERE d.status='active' AND c.is_searchable AND c.embedding IS NOT NULL`,
    );
    const created = await tx.query(
      `INSERT INTO knowledge_conflict_scans (started_by, chunks_total)
       VALUES ($1::uuid, $2) RETURNING id`,
      [actor.userId, total.rows[0].n],
    );
    const id = created.rows[0].id as string;
    await writeAudit(tx, {
      actor,
      action: "knowledge.conflict_scan_started",
      table: "knowledge_conflict_scans",
      recordId: id,
      newValue: { chunks_total: total.rows[0].n },
      request,
    });
    return { id };
  });
}

/**
 * Compares the next active passage with its candidates in the same or shared
 * departments. `expectedCursor` is the cursor the caller last saw; a step that
 * arrives with any other cursor is refused, which makes double-clicks and
 * concurrent admins safe.
 */
export async function stepScan(
  scanId: string,
  expectedCursor: string | null,
  actor: SessionUser,
  request: Request,
): Promise<{ done: boolean; cursor: string | null; compared: number }> {
  const scans = (await sql`
    SELECT id, status, cursor_chunk_id FROM knowledge_conflict_scans WHERE id=${scanId}::uuid
  `) as Array<{ id: string; status: string; cursor_chunk_id: string | null }>;
  const scan = scans[0];
  if (!scan) throw NotFound("Scan not found");
  if (scan.status === "complete") return { done: true, cursor: scan.cursor_chunk_id, compared: 0 };
  if ((scan.cursor_chunk_id ?? null) !== expectedCursor) {
    throw Conflict("This scan has already moved on. Refresh and continue.");
  }

  const next = (await sql`
    SELECT c.id, c.document_id, c.department_id, COALESCE(c.approved_content, c.content) AS content,
           c.heading, c.page_number, c.embedding::text AS embedding, d.title, d.description
      FROM knowledge_chunks c
      JOIN knowledge_documents d ON d.id = c.document_id
     WHERE d.status = 'active' AND c.is_searchable AND c.embedding IS NOT NULL
       AND (${expectedCursor}::uuid IS NULL OR c.id > ${expectedCursor}::uuid)
     ORDER BY c.id
     LIMIT 1
  `) as Array<{
    id: string;
    document_id: string;
    department_id: string;
    content: string;
    heading: string | null;
    page_number: number | null;
    embedding: string;
    title: string;
    description: string | null;
  }>;

  if (!next[0]) {
    const finished = await withTransaction(async (tx) => {
      const { rowCount } = await tx.query(
        `UPDATE knowledge_conflict_scans SET status='complete', completed_at=now()
          WHERE id=$1::uuid AND status='running' AND cursor_chunk_id IS NOT DISTINCT FROM $2::uuid`,
        [scanId, expectedCursor],
      );
      if (!rowCount) throw Conflict("This scan has already moved on. Refresh and continue.");
      await writeAudit(tx, {
        actor,
        action: "knowledge.conflict_scan_completed",
        table: "knowledge_conflict_scans",
        recordId: scanId,
        request,
      });
      return true;
    });
    return { done: finished, cursor: expectedCursor, compared: 0 };
  }

  const passage = next[0];
  // Same or shared departments only, matching how the per-document review scopes
  // its candidates: passages from unrelated departments are not compared, so
  // legitimately different department rules are never reported as conflicts.
  // Pairs already compared (from either side) are excluded, which is the dedupe.
  const candidates = (await sql`
    WITH scoped AS (
      SELECT c.id AS chunk_id, c.document_id, d.title AS document_title, c.department_id,
             COALESCE(c.approved_content, c.content) AS content, c.heading, c.page_number, c.embedding
        FROM knowledge_chunks c
        JOIN knowledge_documents d ON d.id = c.document_id AND d.status = 'active'
        JOIN departments dep ON dep.id = d.department_id
        JOIN departments own_dep ON own_dep.id = ${passage.department_id}::uuid
       WHERE c.is_searchable AND c.embedding IS NOT NULL
         AND c.document_id <> ${passage.document_id}::uuid
         AND (own_dep.is_shared OR dep.is_shared OR c.department_id = ${passage.department_id}::uuid)
         AND NOT EXISTS (
           SELECT 1 FROM knowledge_pair_comparisons p
            WHERE p.chunk_low = LEAST(c.id, ${passage.id}::uuid)
              AND p.chunk_high = GREATEST(c.id, ${passage.id}::uuid))
    ),
    vector_hits AS (SELECT chunk_id FROM scoped ORDER BY embedding <=> ${passage.embedding}::vector LIMIT 8),
    text_hits AS (SELECT chunk_id FROM scoped ORDER BY similarity(content, ${passage.content}) DESC LIMIT 8)
    SELECT chunk_id, document_id, document_title, department_id, content, heading, page_number
      FROM scoped
     WHERE chunk_id IN (SELECT chunk_id FROM vector_hits UNION SELECT chunk_id FROM text_hits)
     ORDER BY chunk_id
  `) as Array<Omit<ReviewMatch, "relation" | "explanation">>;

  // Outside the transaction: a model call must never hold database locks.
  // classifyPassage returns 'uncertain' when every provider fails, so a failed
  // comparison is recorded for human review and never treated as 'new'.
  const matches = candidates.length
    ? await classifyPassage(
        passage.content,
        candidates.map((c) => ({ ...c, relation: "uncertain", explanation: "" })),
        {
          title: passage.title,
          description: passage.description,
          heading: passage.heading,
          page_number: passage.page_number,
        },
      )
    : [];

  await withTransaction(async (tx) => {
    const advanced = await tx.query(
      `UPDATE knowledge_conflict_scans SET cursor_chunk_id=$2::uuid, chunks_done=chunks_done+1
        WHERE id=$1::uuid AND status='running' AND cursor_chunk_id IS NOT DISTINCT FROM $3::uuid
        RETURNING id`,
      [scanId, passage.id, expectedCursor],
    );
    if (!advanced.rowCount) throw Conflict("This scan has already moved on. Refresh and continue.");
    for (const match of matches) {
      await tx.query(
        `INSERT INTO knowledge_pair_comparisons (chunk_low, chunk_high, relation, explanation, scan_id)
         VALUES (LEAST($1::uuid,$2::uuid), GREATEST($1::uuid,$2::uuid), $3, $4, $5::uuid)
         ON CONFLICT DO NOTHING`,
        [passage.id, match.chunk_id, match.relation, match.explanation, scanId],
      );
    }
  });

  return { done: false, cursor: passage.id, compared: candidates.length };
}

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
  relation: (typeof FINDING_RELATIONS)[number];
  explanation: string;
  a: ScanSide;
  b: ScanSide;
}

/**
 * Current status plus the deduplicated findings. A finding is shown only while
 * both passages are still active and searchable, so anything later superseded or
 * archived drops out of the list automatically.
 */
export async function getScan(scanId: string | null) {
  const scans = (await sql`
    SELECT id, status, cursor_chunk_id, chunks_total, chunks_done, started_at, completed_at
      FROM knowledge_conflict_scans
     WHERE ${scanId}::uuid IS NULL OR id = ${scanId}::uuid
     ORDER BY started_at DESC LIMIT 1
  `) as ScanRow[];

  const rows = (await sql`
    SELECT p.relation, p.explanation,
           ca.id AS a_id, ca.document_id AS a_doc, da.title AS a_title, depa.name AS a_dept,
           ca.heading AS a_heading, ca.page_number AS a_page, COALESCE(ca.approved_content, ca.content) AS a_content,
           cb.id AS b_id, cb.document_id AS b_doc, db.title AS b_title, depb.name AS b_dept,
           cb.heading AS b_heading, cb.page_number AS b_page, COALESCE(cb.approved_content, cb.content) AS b_content
      FROM knowledge_pair_comparisons p
      JOIN knowledge_chunks ca ON ca.id = p.chunk_low AND ca.is_searchable
      JOIN knowledge_chunks cb ON cb.id = p.chunk_high AND cb.is_searchable
      JOIN knowledge_documents da ON da.id = ca.document_id AND da.status = 'active'
      JOIN knowledge_documents db ON db.id = cb.document_id AND db.status = 'active'
      JOIN departments depa ON depa.id = ca.department_id
      JOIN departments depb ON depb.id = cb.department_id
     WHERE p.relation IN ('conflict','uncertain','overlap','duplicate')
     ORDER BY CASE p.relation WHEN 'conflict' THEN 0 WHEN 'uncertain' THEN 1 WHEN 'overlap' THEN 2 ELSE 3 END,
              p.compared_at
     LIMIT 200
  `) as Array<Record<string, unknown>>;

  const findings: ScanFinding[] = rows.map((r) => ({
    relation: r.relation as ScanFinding["relation"],
    explanation: r.explanation as string,
    a: {
      chunk_id: r.a_id as string,
      document_id: r.a_doc as string,
      title: r.a_title as string,
      department: r.a_dept as string,
      heading: r.a_heading as string | null,
      page_number: r.a_page as number | null,
      content: r.a_content as string,
    },
    b: {
      chunk_id: r.b_id as string,
      document_id: r.b_doc as string,
      title: r.b_title as string,
      department: r.b_dept as string,
      heading: r.b_heading as string | null,
      page_number: r.b_page as number | null,
      content: r.b_content as string,
    },
  }));

  const counts = Object.fromEntries(
    FINDING_RELATIONS.map((k) => [k, findings.filter((f) => f.relation === k).length]),
  );

  return { scan: scans[0] ?? null, findings, counts };
}
