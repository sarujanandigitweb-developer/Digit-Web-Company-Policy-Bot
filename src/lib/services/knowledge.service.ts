import { sql, withTransaction } from "@/lib/db/client.server";
import { write as writeAudit } from "@/lib/audit/log.server";
import { knowledgeScope, type SessionUser } from "@/lib/auth/session.server";
import { BadRequest, Conflict, NotFound } from "@/lib/http/errors";
import {
  fileTypeFromName,
  MAX_FILE_BYTES,
  parse,
  type FileType,
} from "@/lib/knowledge/parse.server";
import { serializePages } from "@/lib/knowledge/process.server";
import { createHash } from "node:crypto";

export type DocumentStatus = "draft" | "processing" | "active" | "inactive" | "failed" | "archived";

export interface KnowledgeDocument {
  id: string;
  department_id: string;
  department_name: string | null;
  title: string;
  description: string | null;
  file_name: string;
  file_type: FileType;
  file_size_bytes: number;
  checksum: string;
  version: number;
  supersedes_id: string | null;
  status: DocumentStatus;
  processing_error: string | null;
  processing_attempts: number;
  processing_started_at: string | null;
  processing_completed_at: string | null;
  chunk_count: number;
  embedded_count: number;
  page_count: number | null;
  uploaded_by: string | null;
  uploaded_by_name: string | null;
  created_at: string;
  updated_at: string;
}

// extracted_text is never selected into list/detail responses: it is the whole
// document body and would dwarf the metadata callers actually asked for.
const DOCUMENT_COLUMNS = `
  d.id, d.department_id, dep.name AS department_name, d.title, d.description,
  d.file_name, d.file_type, d.file_size_bytes, d.checksum, d.version, d.supersedes_id,
  d.status, d.processing_error, d.processing_attempts, d.processing_started_at,
  d.processing_completed_at, d.chunk_count, d.page_count, d.uploaded_by,
  p.full_name AS uploaded_by_name, d.created_at, d.updated_at,
  (SELECT count(*) FROM knowledge_chunks c
    WHERE c.document_id = d.id AND c.embedding IS NOT NULL)::int AS embedded_count
`;

const DOCUMENT_JOINS = `
  FROM knowledge_documents d
  LEFT JOIN departments dep ON dep.id = d.department_id
  LEFT JOIN profiles p ON p.user_id = d.uploaded_by
`;

export interface ListDocumentsQuery {
  page: number;
  pageSize: number;
  search?: string;
  departmentId?: string;
  status?: DocumentStatus;
  sortBy?: string;
  sortDir?: "asc" | "desc";
}

/** Allowlisted sort columns — see the note in users.service.ts. */
const DOCUMENT_SORT_SQL: Record<string, string> = {
  title: "d.title",
  department: "dep.name",
  version: "d.version",
  status: "d.status",
  chunks: "d.chunk_count",
  created: "d.created_at",
  updated: "d.updated_at",
};

export async function list(
  query: ListDocumentsQuery,
  /** When set (a team leader's department), the list is hard-limited to it. */
  restrictTo: string | null = null,
): Promise<{ items: KnowledgeDocument[]; total: number }> {
  const offset = (query.page - 1) * query.pageSize;
  const search = query.search ?? null;
  const orderColumn = DOCUMENT_SORT_SQL[query.sortBy ?? "created"] ?? DOCUMENT_SORT_SQL.created;
  const orderDir = query.sortDir === "asc" ? "ASC" : "DESC";

  const rows = (await sql`
    SELECT ${sql.unsafe(DOCUMENT_COLUMNS)}, count(*) OVER()::int AS total_count
    ${sql.unsafe(DOCUMENT_JOINS)}
    WHERE (${search}::text IS NULL
             OR d.title ILIKE '%' || ${search} || '%'
             OR d.file_name ILIKE '%' || ${search} || '%')
      AND (${query.departmentId ?? null}::uuid IS NULL
             OR d.department_id = ${query.departmentId ?? null}::uuid)
      -- Scope guard: a team leader only ever sees their own department, no matter
      -- what departmentId the client asked for.
      AND (${restrictTo}::uuid IS NULL OR d.department_id = ${restrictTo}::uuid)
      AND (${query.status ?? null}::document_status IS NULL
             OR d.status = ${query.status ?? null}::document_status)
    ORDER BY ${sql.unsafe(orderColumn)} ${sql.unsafe(orderDir)} NULLS LAST, d.id
    LIMIT ${query.pageSize} OFFSET ${offset}
  `) as Array<KnowledgeDocument & { total_count: number }>;

  const items = rows.map(({ total_count: _t, ...item }) => item);
  return { items, total: rows[0]?.total_count ?? 0 };
}

export async function getById(
  id: string,
  /** A team leader's department. A document outside it 404s, hiding its existence. */
  restrictTo: string | null = null,
): Promise<KnowledgeDocument> {
  const rows = (await sql`
    SELECT ${sql.unsafe(DOCUMENT_COLUMNS)} ${sql.unsafe(DOCUMENT_JOINS)}
    WHERE d.id = ${id}::uuid
  `) as KnowledgeDocument[];
  const doc = rows[0];
  if (!doc || (restrictTo && doc.department_id !== restrictTo))
    throw NotFound("Document not found");
  return doc;
}

/**
 * Guards a write action against a document outside the actor's scope. A team
 * leader acting on another department's document is refused as if the document
 * did not exist, so scoping never leaks which documents live elsewhere.
 */
function assertInScope(actor: SessionUser, documentDepartmentId: string): void {
  const scope = knowledgeScope(actor);
  if (scope && documentDepartmentId !== scope) throw NotFound("Document not found");
}

export interface ChunkRow {
  id: string;
  chunk_index: number;
  content: string;
  heading: string | null;
  page_number: number | null;
  has_embedding: boolean;
}

export async function listChunks(
  documentId: string,
  limit = 100,
  offset = 0,
  restrictTo: string | null = null,
) {
  await getById(documentId, restrictTo); // 404s for an unknown or out-of-scope document.
  const rows = (await sql`
    SELECT id, chunk_index, content, heading, page_number,
           (embedding IS NOT NULL) AS has_embedding,
           count(*) OVER()::int AS total_count
      FROM knowledge_chunks
     WHERE document_id = ${documentId}::uuid
     ORDER BY chunk_index
     LIMIT ${limit} OFFSET ${offset}
  `) as Array<ChunkRow & { total_count: number }>;
  const items = rows.map(({ total_count: _t, ...c }) => c);
  return { items, total: rows[0]?.total_count ?? 0 };
}

export interface UploadInput {
  fileName: string;
  buffer: Buffer;
  title: string;
  description?: string;
  departmentId: string;
  /** Set when replacing: the document this supersedes. */
  replacesId?: string;
}

/**
 * Validates and stores an upload, leaving it queued for processing.
 *
 * Parsing happens here (it is fast and its failure is the caller's problem);
 * chunking and embedding do not (they are slow and their failure is not).
 * The document lands as 'processing' and the caller schedules the rest.
 */
export async function upload(
  input: UploadInput,
  actor: SessionUser,
  request: Request,
): Promise<KnowledgeDocument> {
  if (input.buffer.length === 0) throw BadRequest("File is empty");
  if (input.buffer.length > MAX_FILE_BYTES) {
    throw BadRequest(`File exceeds the ${MAX_FILE_BYTES / 1024 / 1024}MB limit`);
  }

  // A team leader can only upload into the department they lead — the chosen
  // department is overridden rather than trusted, so a crafted request can't
  // plant a document in someone else's department.
  const scope = knowledgeScope(actor);
  if (scope) input = { ...input, departmentId: scope };

  const fileType = fileTypeFromName(input.fileName);
  const checksum = createHash("sha256").update(input.buffer).digest("hex");

  const department = (await sql`
    SELECT status FROM departments WHERE id = ${input.departmentId}::uuid
  `) as Array<{ status: string }>;
  if (!department[0]) throw BadRequest("Department not found");
  if (department[0].status !== "active") throw BadRequest("Department is not active");

  // Identical content already live in this department is a no-op, not a new
  // version — re-embedding it would cost money and split retrieval across
  // duplicate chunks.
  const duplicate = (await sql`
    SELECT id, title FROM knowledge_documents
     WHERE department_id = ${input.departmentId}::uuid
       AND checksum = ${checksum}
       AND status <> 'archived'
     LIMIT 1
  `) as Array<{ id: string; title: string }>;
  if (duplicate[0]) {
    throw Conflict(`This exact file is already uploaded as "${duplicate[0].title}"`, {
      existingDocumentId: duplicate[0].id,
    });
  }

  const parsed = await parse(input.buffer, fileType);
  const extractedText = serializePages(parsed.pages);
  if (!extractedText.trim()) {
    throw BadRequest("No readable text found in this file");
  }

  let previous: { id: string; version: number } | null = null;
  if (input.replacesId) {
    const rows = (await sql`
      SELECT id, version FROM knowledge_documents WHERE id = ${input.replacesId}::uuid
    `) as Array<{ id: string; version: number }>;
    if (!rows[0]) throw NotFound("The document being replaced does not exist");
    previous = rows[0];
  }

  return withTransaction(async (tx) => {
    // Archived first: the partial unique index allows only one non-archived row
    // per (department, checksum), and the replacement must be able to take it.
    if (previous) {
      await tx.query(`UPDATE knowledge_documents SET status = 'archived' WHERE id = $1::uuid`, [
        previous.id,
      ]);
    }

    const { rows } = await tx.query(
      `INSERT INTO knowledge_documents
         (department_id, title, description, file_name, file_type, file_size_bytes,
          checksum, extracted_text, page_count, version, supersedes_id, status, uploaded_by)
       VALUES ($1::uuid,$2,$3,$4,$5::document_file_type,$6,$7,$8,$9,$10,$11::uuid,'processing',$12::uuid)
       RETURNING id`,
      [
        input.departmentId,
        input.title,
        input.description ?? null,
        input.fileName,
        fileType,
        input.buffer.length,
        checksum,
        extractedText,
        parsed.pageCount,
        previous ? previous.version + 1 : 1,
        previous?.id ?? null,
        actor.userId,
      ],
    );
    const id = rows[0].id as string;

    await writeAudit(tx, {
      actor,
      action: previous ? "knowledge.replaced" : "knowledge.uploaded",
      table: "knowledge_documents",
      recordId: id,
      oldValue: previous ? { id: previous.id, version: previous.version } : undefined,
      newValue: { id, title: input.title, fileName: input.fileName, checksum },
      request,
    });

    return id;
  }).then(getById);
}

/** Activate / archive. Only 'active' documents are retrievable. */
export async function setStatus(
  id: string,
  status: "active" | "archived" | "inactive",
  actor: SessionUser,
  request: Request,
): Promise<KnowledgeDocument> {
  await withTransaction(async (tx) => {
    const before = await tx.query(
      `SELECT * FROM knowledge_documents WHERE id = $1::uuid FOR UPDATE`,
      [id],
    );
    if (!before.rowCount) throw NotFound("Document not found");
    assertInScope(actor, before.rows[0].department_id);
    const current = before.rows[0] as { status: DocumentStatus; chunk_count: number };

    if (status === "active" && current.status === "processing") {
      throw Conflict("Document is still processing");
    }

    // Counted live rather than read from chunk_count: that column is a cached
    // total and a document whose chunks went away would still claim to have
    // them. Activating on a stale counter would publish a document retrieval can
    // never return, hiding a failed ingestion behind a green status. Embedded
    // chunks specifically — an un-embedded chunk is invisible to search.
    if (status === "active") {
      const usable = await tx.query(
        `SELECT count(*)::int AS count FROM knowledge_chunks
          WHERE document_id = $1::uuid AND embedding IS NOT NULL`,
        [id],
      );
      if (usable.rows[0].count === 0) {
        throw Conflict(
          "Cannot activate a document with no embedded chunks. Retry processing first.",
        );
      }
    }

    const { rows } = await tx.query(
      `UPDATE knowledge_documents SET status = $2::document_status WHERE id = $1::uuid RETURNING *`,
      [id, status],
    );

    await writeAudit(tx, {
      actor,
      action:
        status === "active"
          ? "knowledge.activated"
          : status === "archived"
            ? "knowledge.archived"
            : "knowledge.deactivated",
      table: "knowledge_documents",
      recordId: id,
      oldValue: { status: current.status },
      newValue: { status: rows[0].status },
      request,
    });
  });
  return getById(id);
}

export interface UpdateDocumentInput {
  title?: string;
  description?: string | null;
  departmentId?: string;
}

/**
 * Edits a document's metadata — title, description, department — without
 * touching the file or re-processing. Cheaper and safer than re-uploading when a
 * document was filed under the wrong department or mistitled.
 *
 * Changing the department also rewrites every chunk's denormalized
 * department_id: the sync trigger only fires when a chunk's document_id changes,
 * so a document-level department change would otherwise leave the chunks — and
 * therefore retrieval, which filters on chunk.department_id — pointing at the old
 * department. Both updates run in one transaction so they cannot diverge.
 */
export async function updateMetadata(
  id: string,
  input: UpdateDocumentInput,
  actor: SessionUser,
  request: Request,
): Promise<KnowledgeDocument> {
  // Team leaders may edit title and description but not move a document out of
  // (or into) their department, so the department change is dropped for them.
  if (knowledgeScope(actor)) input = { ...input, departmentId: undefined };

  if (input.departmentId) {
    const dept = (await sql`
      SELECT status FROM departments WHERE id = ${input.departmentId}::uuid
    `) as Array<{ status: string }>;
    if (!dept[0]) throw BadRequest("Department not found");
    if (dept[0].status !== "active") throw BadRequest("Department is not active");
  }

  await withTransaction(async (tx) => {
    const before = await tx.query(
      `SELECT * FROM knowledge_documents WHERE id = $1::uuid FOR UPDATE`,
      [id],
    );
    if (!before.rowCount) throw NotFound("Document not found");
    assertInScope(actor, before.rows[0].department_id);
    const current = before.rows[0] as { department_id: string; checksum: string; status: string };

    // The (department_id, checksum) uniqueness over non-archived rows means moving
    // a document into a department that already holds the same file would collide.
    // Surface that as a clear 409 rather than a raw constraint error.
    if (input.departmentId && input.departmentId !== current.department_id) {
      const clash = await tx.query(
        `SELECT 1 FROM knowledge_documents
          WHERE department_id = $1::uuid AND checksum = $2 AND status <> 'archived' AND id <> $3::uuid`,
        [input.departmentId, current.checksum, id],
      );
      if (clash.rowCount) {
        throw Conflict("The target department already has this exact file.");
      }
    }

    const { rows } = await tx.query(
      `UPDATE knowledge_documents SET
         title = COALESCE($2, title),
         description = CASE WHEN $3::bool THEN $4 ELSE description END,
         department_id = COALESCE($5::uuid, department_id)
       WHERE id = $1::uuid
       RETURNING *`,
      [
        id,
        input.title ?? null,
        Object.prototype.hasOwnProperty.call(input, "description"),
        input.description ?? null,
        input.departmentId ?? null,
      ],
    );
    const after = rows[0] as { department_id: string };

    // Keep chunks in step with the document's department.
    if (after.department_id !== current.department_id) {
      await tx.query(
        `UPDATE knowledge_chunks SET department_id = $2::uuid WHERE document_id = $1::uuid`,
        [id, after.department_id],
      );
    }

    await writeAudit(tx, {
      actor,
      action: "knowledge.updated",
      table: "knowledge_documents",
      recordId: id,
      oldValue: {
        title: before.rows[0].title,
        description: before.rows[0].description,
        department_id: current.department_id,
      },
      newValue: {
        title: rows[0].title,
        description: rows[0].description,
        department_id: after.department_id,
      },
      request,
    });
  });
  return getById(id);
}

export async function remove(id: string, actor: SessionUser, request: Request): Promise<void> {
  await withTransaction(async (tx) => {
    const before = await tx.query(
      `SELECT * FROM knowledge_documents WHERE id = $1::uuid FOR UPDATE`,
      [id],
    );
    if (!before.rowCount) throw NotFound("Document not found");
    assertInScope(actor, before.rows[0].department_id);
    const { extracted_text: _drop, ...auditable } = before.rows[0];

    await writeAudit(tx, {
      actor,
      action: "knowledge.deleted",
      table: "knowledge_documents",
      recordId: id,
      oldValue: auditable, // without the body: an audit row is not a backup
      request,
    });

    // knowledge_chunks cascades; message_citations cascade from the chunks, so
    // historical answers lose their citation links rather than dangling.
    await tx.query(`DELETE FROM knowledge_documents WHERE id = $1::uuid`, [id]);
  });
}

export interface KnowledgeStats {
  total_documents: number;
  draft: number;
  processing: number;
  active: number;
  failed: number;
  archived: number;
  chunk_count: number;
  embedding_count: number;
}

export async function stats(departmentId?: string): Promise<KnowledgeStats> {
  const rows = (await sql`
    SELECT
      count(*)::int AS total_documents,
      count(*) FILTER (WHERE status = 'draft')::int      AS draft,
      count(*) FILTER (WHERE status = 'processing')::int AS processing,
      count(*) FILTER (WHERE status = 'active')::int     AS active,
      count(*) FILTER (WHERE status = 'failed')::int     AS failed,
      count(*) FILTER (WHERE status = 'archived')::int   AS archived,
      COALESCE((SELECT count(*) FROM knowledge_chunks c
                 JOIN knowledge_documents kd ON kd.id = c.document_id
                WHERE ${departmentId ?? null}::uuid IS NULL
                   OR kd.department_id = ${departmentId ?? null}::uuid), 0)::int AS chunk_count,
      -- Distinct from chunk_count: a chunk exists before its vector does, so the
      -- gap between these two is exactly the work still outstanding.
      COALESCE((SELECT count(*) FROM knowledge_chunks c
                 JOIN knowledge_documents kd ON kd.id = c.document_id
                WHERE c.embedding IS NOT NULL
                  AND (${departmentId ?? null}::uuid IS NULL
                       OR kd.department_id = ${departmentId ?? null}::uuid)), 0)::int AS embedding_count
    FROM knowledge_documents d
    WHERE ${departmentId ?? null}::uuid IS NULL
       OR d.department_id = ${departmentId ?? null}::uuid
  `) as KnowledgeStats[];
  return rows[0];
}
