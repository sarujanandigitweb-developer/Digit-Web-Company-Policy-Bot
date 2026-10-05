import { randomUUID } from "node:crypto";
import { sql, withTransaction } from "@/lib/db/client.server";
import { knowledgeScope, type SessionUser } from "@/lib/auth/session.server";
import { write as writeAudit } from "@/lib/audit/log.server";
import { BadRequest, Conflict, Forbidden, NotFound } from "@/lib/http/errors";
import { classifyPassage } from "./classify.server";
import { embedAll, toVectorLiteral } from "./embed.server";
import {
  summarizeRelations,
  validateDecision,
  type ReviewDecision,
  type ReviewKind,
  type ReviewMatch,
} from "./review-policy";

// Every publication, lifecycle change and content rewrite uses this same lock.
export const KNOWLEDGE_WRITE_LOCK = 707051;

interface ReviewDocument {
  title: string;
  description: string | null;
  id: string;
  department_id: string;
  status: string;
  review_state: string;
  review_origin: string;
  review_run: string | null;
  review_basis: string | null;
  review_error: string | null;
  supersedes_id: string | null;
}
export interface ReviewRow {
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
  reviewed_at: string | null;
}

async function documentForReview(id: string, actor?: SessionUser): Promise<ReviewDocument> {
  const rows =
    await sql`SELECT id, title, description, department_id, status, review_state, review_origin,
    review_run, review_basis, review_error, supersedes_id FROM knowledge_documents WHERE id=${id}::uuid`;
  const doc = rows[0] as ReviewDocument | undefined;
  if (
    !doc ||
    (actor?.role === "team_leader" &&
      (!actor.departmentId || doc.department_id !== knowledgeScope(actor)))
  ) {
    throw NotFound("Document not found");
  }
  return doc;
}

export async function getReview(id: string, actor: SessionUser, page = 1) {
  const doc = await documentForReview(id, actor);
  const totals = await sql`SELECT count(*)::int AS total,
    count(*) FILTER (WHERE kind IS NOT NULL)::int AS compared,
    count(*) FILTER (WHERE kind IS NOT NULL AND decision IS NULL)::int AS unresolved
    FROM knowledge_chunk_reviews WHERE document_id=${id}::uuid`;
  const rows = await sql`SELECT r.*, c.chunk_index, c.heading, c.page_number
    FROM knowledge_chunk_reviews r JOIN knowledge_chunks c ON c.id=r.chunk_id
    WHERE r.document_id=${id}::uuid ORDER BY c.chunk_index LIMIT 20 OFFSET ${(page - 1) * 20}`;
  const basis = await sql`SELECT knowledge_review_basis(${id}::uuid) AS basis`;
  return {
    ...doc,
    ...totals[0],
    stale: !!doc.review_basis && doc.review_basis !== basis[0].basis,
    items: rows as ReviewRow[],
    page,
    pageSize: 20,
  };
}

/** Explicit scan also works on old active documents; they wait for republication. */
export async function startReview(id: string, actor: SessionUser, request: Request) {
  await documentForReview(id, actor);
  await withTransaction(async (tx) => {
    await tx.query(`SELECT pg_advisory_xact_lock($1)`, [KNOWLEDGE_WRITE_LOCK]);
    const { rows } = await tx.query(
      `SELECT * FROM knowledge_documents WHERE id=$1::uuid FOR UPDATE`,
      [id],
    );
    const doc = rows[0];
    if (!doc) throw NotFound("Document not found");
    if (actor.role === "team_leader" && doc.department_id !== actor.departmentId)
      throw NotFound("Document not found");
    if (!["active", "pending_review", "inactive"].includes(doc.status))
      throw Conflict("Finish processing before scanning this document");
    const count = await tx.query(
      `SELECT count(*)::int AS n FROM knowledge_chunks WHERE document_id=$1::uuid AND embedding IS NOT NULL`,
      [id],
    );
    if (!count.rows[0].n) throw Conflict("No embedded passages to compare");
    const existingSource =
      doc.status === "active" ||
      doc.review_state === "published" ||
      doc.review_state === "none" ||
      doc.review_origin === "existing";
    if (existingSource) {
      const retained = await tx.query(
        `SELECT count(*)::int AS n FROM knowledge_chunks WHERE document_id=$1::uuid AND is_searchable AND embedding IS NOT NULL`,
        [id],
      );
      if (!retained.rows[0].n) {
        // Another approved correction may have retired all this document's
        // passages. Clear its stale quarantine without resurrecting the source.
        await tx.query(`DELETE FROM knowledge_chunk_reviews WHERE document_id=$1::uuid`, [id]);
        await tx.query(
          `UPDATE knowledge_documents SET status='inactive',review_state='published',review_run=NULL,
            review_basis=NULL,review_error=NULL WHERE id=$1::uuid`,
          [id],
        );
        await writeAudit(tx, {
          actor,
          action: "knowledge.review_started",
          table: "knowledge_documents",
          recordId: id,
          newValue: {
            status: "inactive",
            reason: "No retained passages remain after approved corrections",
          },
          request,
        });
        return;
      }
    }
    await tx.query(`DELETE FROM knowledge_chunk_reviews WHERE document_id=$1::uuid`, [id]);
    await tx.query(
      `UPDATE knowledge_documents SET status=CASE WHEN status='active' THEN 'active'::document_status ELSE 'pending_review'::document_status END, review_state='queued',
      review_origin=CASE WHEN status='active' OR review_state='published' OR review_state='none' THEN 'existing' ELSE review_origin END,
      review_run=$2::uuid, review_error=NULL WHERE id=$1::uuid`,
      [id, randomUUID()],
    );
    await tx.query(
      `INSERT INTO knowledge_chunk_reviews(chunk_id,document_id,incoming_content)
      SELECT id,document_id,COALESCE(approved_content,content) FROM knowledge_chunks
      WHERE document_id=$1::uuid AND embedding IS NOT NULL
        AND (is_searchable OR (SELECT review_origin='upload' FROM knowledge_documents WHERE id=$1::uuid))`,
      [id],
    );
    await tx.query(
      `UPDATE knowledge_documents SET review_basis=knowledge_review_basis(id) WHERE id=$1::uuid`,
      [id],
    );
    await writeAudit(tx, {
      actor,
      action: "knowledge.review_started",
      table: "knowledge_documents",
      recordId: id,
      oldValue: { status: doc.status, review_run: doc.review_run },
      newValue: {
        review_state: "queued",
        review_origin: doc.status === "active" ? "existing" : doc.review_origin,
      },
      request,
    });
  });
  return getReview(id, actor);
}

/** One resumable passage per request; no serverless request drains a whole file. */
export async function compareNext(id: string, actor?: SessionUser) {
  const doc = await documentForReview(id, actor);
  if (
    doc.status !== "pending_review" &&
    !(
      doc.status === "active" &&
      doc.review_origin === "existing" &&
      doc.review_state !== "published"
    )
  )
    throw Conflict("This document is not awaiting review");
  const basis = await sql`SELECT knowledge_review_basis(${id}::uuid) AS basis`;
  if (basis[0].basis !== doc.review_basis)
    throw Conflict(
      "The approved knowledge changed. Restart the comparison before deciding or publishing.",
    );
  const pending =
    await sql`SELECT r.chunk_id, r.incoming_content, c.embedding::text, c.chunk_index, c.heading, c.page_number
    FROM knowledge_chunk_reviews r JOIN knowledge_chunks c ON c.id=r.chunk_id
    WHERE r.document_id=${id}::uuid AND r.kind IS NULL ORDER BY c.chunk_index LIMIT 1`;
  if (!pending.length) {
    await sql`UPDATE knowledge_documents SET review_state='ready', review_error=NULL WHERE id=${id}::uuid AND review_run=${doc.review_run}::uuid AND review_state<>'published'`;
    return;
  }
  const incoming = pending[0];
  await sql`UPDATE knowledge_documents SET review_state='comparing', review_error=NULL WHERE id=${id}::uuid AND review_run=${doc.review_run}::uuid AND review_state<>'published'`;
  try {
    // Union semantic and lexical candidates. No similarity cutoff: a changed
    // number or negation must not be mistaken for new information. Shared
    // policies compare against every department they can affect.
    const candidates = await sql`
      WITH scoped AS (
        SELECT c.id AS chunk_id,c.document_id,d.title AS document_title,c.department_id,
          COALESCE(c.approved_content,c.content) AS content,c.heading,c.page_number,c.embedding
        FROM knowledge_chunks c JOIN knowledge_documents d ON d.id=c.document_id
        JOIN departments dep ON dep.id=d.department_id
        JOIN knowledge_documents incoming ON incoming.id=${id}::uuid
        JOIN departments incoming_dep ON incoming_dep.id=incoming.department_id
        WHERE c.embedding IS NOT NULL AND (
          (d.status='active' AND c.is_searchable AND d.id<>incoming.id AND
            (incoming_dep.is_shared OR dep.is_shared OR d.department_id=incoming.department_id))
          OR (d.id=incoming.id AND c.chunk_index<${incoming.chunk_index} AND EXISTS (
            SELECT 1 FROM knowledge_chunk_reviews earlier WHERE earlier.chunk_id=c.id
            AND earlier.decision IS DISTINCT FROM 'keep_existing'))
        )
      ), vector_hits AS (SELECT chunk_id FROM scoped ORDER BY embedding <=> ${incoming.embedding}::vector LIMIT 8),
      text_hits AS (SELECT chunk_id FROM scoped ORDER BY similarity(content,${incoming.incoming_content}) DESC LIMIT 8)
      SELECT chunk_id,document_id,document_title,department_id,content,heading,page_number
      FROM scoped WHERE chunk_id IN (SELECT chunk_id FROM vector_hits UNION SELECT chunk_id FROM text_hits)
      ORDER BY chunk_id`;
    const matches = await classifyPassage(
      incoming.incoming_content as string,
      candidates.map((c) => ({ ...c, relation: "uncertain", explanation: "" })) as ReviewMatch[],
      {
        title: doc.title,
        description: doc.description,
        heading: incoming.heading as string | null,
        page_number: incoming.page_number as number | null,
      },
    );
    const relevant = matches.filter((m) => m.relation !== "new");
    const kind = summarizeRelations(relevant);
    await withTransaction(async (tx) => {
      const current = await tx.query(
        `SELECT review_run,status,review_origin FROM knowledge_documents WHERE id=$1::uuid FOR UPDATE`,
        [id],
      );
      if (
        current.rows[0]?.review_run !== doc.review_run ||
        (current.rows[0]?.status !== "pending_review" &&
          !(current.rows[0]?.status === "active" && current.rows[0]?.review_origin === "existing"))
      )
        throw Conflict("Comparison was restarted. Refresh the review.");
      await tx.query(
        `UPDATE knowledge_chunk_reviews SET kind=$2,matches=$3::jsonb,
        decision=CASE WHEN $2='new' THEN 'include' ELSE NULL END
        WHERE chunk_id=$1::uuid AND kind IS NULL`,
        [incoming.chunk_id, kind, JSON.stringify(relevant)],
      );
      await tx.query(
        `UPDATE knowledge_documents SET review_state=CASE WHEN EXISTS (
        SELECT 1 FROM knowledge_chunk_reviews WHERE document_id=$1::uuid AND kind IS NULL
      ) THEN 'queued' ELSE 'ready' END,review_error=NULL WHERE id=$1::uuid`,
        [id],
      );
    });
  } catch (error) {
    await sql`UPDATE knowledge_documents SET review_state='error',review_error='Comparison could not finish. Retry or restart the scan.'
      WHERE id=${id}::uuid AND review_run=${doc.review_run}::uuid AND status IN ('active','pending_review') AND review_state<>'published'`;
    throw error;
  }
}

export async function decide(
  id: string,
  input: {
    chunkId: string;
    decision: ReviewDecision;
    excerpt?: string;
    note?: string;
    run: string;
  },
  actor: SessionUser,
  request: Request,
) {
  await documentForReview(id, actor);
  await withTransaction(async (tx) => {
    await tx.query(`SELECT pg_advisory_xact_lock($1)`, [KNOWLEDGE_WRITE_LOCK]);
    const docs = await tx.query(`SELECT * FROM knowledge_documents WHERE id=$1::uuid FOR UPDATE`, [
      id,
    ]);
    const doc = docs.rows[0];
    if (!doc || (actor.role === "team_leader" && doc.department_id !== actor.departmentId))
      throw NotFound("Document not found");
    if (
      (doc.status !== "pending_review" &&
        !(doc.status === "active" && doc.review_origin === "existing")) ||
      doc.review_run !== input.run
    )
      throw Conflict("Refresh the review before deciding");
    const basis = await tx.query(`SELECT knowledge_review_basis($1::uuid) AS basis`, [id]);
    if (basis.rows[0].basis !== doc.review_basis)
      throw Conflict("Knowledge changed. Restart the comparison.");
    const { rows } = await tx.query(
      `SELECT * FROM knowledge_chunk_reviews WHERE chunk_id=$1::uuid AND document_id=$2::uuid FOR UPDATE`,
      [input.chunkId, id],
    );
    const review = rows[0];
    if (!review) throw NotFound("Passage not found");
    let excerpt: string | null;
    try {
      excerpt = validateDecision({ kind: review.kind, content: review.incoming_content, ...input });
    } catch (e) {
      throw BadRequest(e instanceof Error ? e.message : "Invalid decision");
    }
    // A leader may see shared guidance to compare it, but cannot retire it.
    if (
      input.decision === "use_incoming" &&
      actor.role === "team_leader" &&
      (review.matches as ReviewMatch[]).some((m) => m.department_id !== actor.departmentId)
    ) {
      throw Forbidden("An admin must approve replacing shared or other-department guidance");
    }
    await tx.query(
      `UPDATE knowledge_chunk_reviews SET decision=$2,approved_excerpt=$3,note=$4,
      reviewed_by=$5::uuid,reviewed_at=now() WHERE chunk_id=$1::uuid`,
      [input.chunkId, input.decision, excerpt, input.note?.trim() ?? null, actor.userId],
    );
    await writeAudit(tx, {
      actor,
      action: "knowledge.review_decided",
      table: "knowledge_documents",
      recordId: id,
      oldValue: { chunk_id: input.chunkId, decision: review.decision },
      newValue: {
        chunk_id: input.chunkId,
        decision: input.decision,
        excerpt,
        note: input.note,
        run: input.run,
      },
      request,
    });
  });
}

export async function publish(id: string, run: string, actor: SessionUser, request: Request) {
  const doc = await documentForReview(id, actor);
  if (doc.review_run !== run || doc.review_state !== "ready")
    throw Conflict("Complete the current comparison before publishing");
  const excerptRows = await sql`SELECT chunk_id,approved_excerpt FROM knowledge_chunk_reviews
    WHERE document_id=${id}::uuid AND decision='excerpt' ORDER BY chunk_id`;
  // Embedding selected source excerpts happens before the transaction, never
  // holding DB locks during a network/model call. The run and text are checked again.
  const embedded = excerptRows.length
    ? await embedAll(
        excerptRows.map((r) => r.approved_excerpt as string),
        "RETRIEVAL_DOCUMENT",
      )
    : null;
  await withTransaction(async (tx) => {
    await tx.query(`SELECT pg_advisory_xact_lock($1)`, [KNOWLEDGE_WRITE_LOCK]);
    const docs = await tx.query(`SELECT * FROM knowledge_documents WHERE id=$1::uuid FOR UPDATE`, [
      id,
    ]);
    const current = docs.rows[0];
    if (!current || (actor.role === "team_leader" && current.department_id !== actor.departmentId))
      throw NotFound("Document not found");
    if (
      (current.status !== "pending_review" &&
        !(current.status === "active" && current.review_origin === "existing")) ||
      current.review_state !== "ready" ||
      current.review_run !== run ||
      doc.review_run !== run
    )
      throw Conflict("Complete the current comparison before publishing");
    const basis = await tx.query(`SELECT knowledge_review_basis($1::uuid) AS basis`, [id]);
    if (basis.rows[0].basis !== current.review_basis)
      throw Conflict("Approved knowledge changed. Restart the comparison before publishing.");
    const { rows } = await tx.query(
      `SELECT * FROM knowledge_chunk_reviews WHERE document_id=$1::uuid FOR UPDATE`,
      [id],
    );
    if (!rows.length || rows.some((r) => !r.kind || !r.decision))
      throw Conflict("Resolve every overlapping or uncertain passage before publishing");
    const actualExcerpts = rows
      .filter((r) => r.decision === "excerpt")
      .sort((a, b) => a.chunk_id.localeCompare(b.chunk_id));
    if (
      actualExcerpts.length !== excerptRows.length ||
      actualExcerpts.some(
        (r, i) =>
          r.chunk_id !== excerptRows[i].chunk_id ||
          r.approved_excerpt !== excerptRows[i].approved_excerpt,
      )
    )
      throw Conflict("Review decisions changed during embedding. Try publishing again.");
    const excluded = new Set<string>();
    for (const row of rows) {
      if (row.decision === "keep_existing") excluded.add(row.chunk_id);
      if (row.decision === "use_incoming") {
        for (const match of row.matches as ReviewMatch[]) {
          if (actor.role === "team_leader" && match.department_id !== actor.departmentId)
            throw Forbidden("An admin must approve replacing shared guidance");
          excluded.add(match.chunk_id);
        }
      }
    }
    // Never silently drop an incoming passage a reviewer explicitly retained.
    if (rows.some((r) => excluded.has(r.chunk_id) && r.decision !== "keep_existing"))
      throw Conflict(
        "Decisions contradict each other: a retained incoming passage is also being superseded. Keep only the correct passage and review again.",
      );
    // Keeping a duplicate source while simultaneously retiring that source
    // would leave no canonical knowledge behind (notably replacement uploads).
    for (const row of rows.filter((r) => r.decision === "keep_existing")) {
      if (
        !(row.matches as ReviewMatch[]).some(
          (m) =>
            !excluded.has(m.chunk_id) &&
            m.document_id !== current.supersedes_id &&
            (m.document_id !== id ||
              rows.some((r) => r.chunk_id === m.chunk_id && r.decision !== "keep_existing")),
        )
      ) {
        throw Conflict(
          "A kept source would also be removed. Retain the incoming passage instead, or cancel the replacement.",
        );
      }
    }
    for (const row of rows) {
      const index = excerptRows.findIndex((r) => r.chunk_id === row.chunk_id);
      await tx.query(
        `UPDATE knowledge_chunks SET is_searchable=$2,approved_content=$3,
        embedding=CASE WHEN $4::text IS NULL THEN embedding ELSE $4::vector END WHERE id=$1::uuid`,
        [
          row.chunk_id,
          !excluded.has(row.chunk_id),
          row.decision === "excerpt" ? row.approved_excerpt : row.incoming_content,
          index >= 0 ? toVectorLiteral(embedded!.vectors[index]) : null,
        ],
      );
    }
    for (const chunkId of excluded) {
      await tx.query(`UPDATE knowledge_chunks SET is_searchable=false WHERE id=$1::uuid`, [
        chunkId,
      ]);
    }
    if (current.supersedes_id) {
      const previous = await tx.query(
        `SELECT department_id FROM knowledge_documents WHERE id=$1::uuid FOR UPDATE`,
        [current.supersedes_id],
      );
      if (!previous.rowCount || previous.rows[0].department_id !== current.department_id)
        throw Conflict("Replacement source no longer belongs to this department");
      await tx.query(`UPDATE knowledge_documents SET status='archived' WHERE id=$1::uuid`, [
        current.supersedes_id,
      ]);
    }
    const included = rows.filter((r) => !excluded.has(r.chunk_id)).length;
    await tx.query(
      `UPDATE knowledge_documents SET status=$2::document_status,review_state='published',
      published_by=$3::uuid,published_at=now(),review_error=NULL WHERE id=$1::uuid`,
      [id, included ? "active" : "inactive", actor.userId],
    );
    await writeAudit(tx, {
      actor,
      action: "knowledge.review_published",
      table: "knowledge_documents",
      recordId: id,
      newValue: {
        run,
        included,
        excluded_chunk_ids: [...excluded],
        supersedes_id: current.supersedes_id,
        decisions: rows.map((r) => ({
          chunk_id: r.chunk_id,
          decision: r.decision,
          note: r.note,
          reviewed_by: r.reviewed_by,
        })),
      },
      request,
    });
  });
}
