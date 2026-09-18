import { sql } from "@/lib/db/client.server";
import { embedQuery, toVectorLiteral } from "@/lib/knowledge/embed.server";

/**
 * Hybrid retrieval over active documents.
 *
 * Vector search alone reliably misses exact tokens — "48 hours", a section
 * number, a form name — because those carry little semantic weight. Trigram
 * search alone misses paraphrases. Each candidate is scored by both and the
 * scores are blended, so a chunk that is either semantically close or a literal
 * match can surface.
 *
 * Only 'active' documents participate: drafts, failed and archived versions are
 * excluded in SQL rather than filtered afterwards, so a retired policy can never
 * answer a question.
 */

export interface RetrievedChunk {
  chunk_id: string;
  document_id: string;
  document_title: string;
  department_id: string;
  department_name: string;
  content: string;
  heading: string | null;
  page_number: number | null;
  vector_score: number;
  keyword_score: number;
  score: number;
}

export interface RetrieveOptions {
  query: string;
  /**
   * Restrict to one department. When set, the search covers that department's
   * chunks PLUS any department flagged is_shared — never any other department.
   * Ignored when global is true.
   */
  departmentId?: string | null;
  /** Search every department — management, or an explicit "All departments". */
  global?: boolean;
  /** Search ONLY shared (company-wide) knowledge — for general questions asked
   *  before any department is chosen. Never touches a specific department. */
  sharedOnly?: boolean;
  /**
   * Search ONLY this one document — the Knowledge Library's resource workspace.
   *
   * This is the narrowest scope and it overrides every other one: department,
   * shared and global are all switched off when it is set. There is deliberately
   * no fallback of any kind. A question the resource cannot answer returns no
   * rows, and the caller says so, rather than quietly answering from somewhere
   * the user did not choose.
   */
  documentId?: string | null;
  limit?: number;
  /** Blend weight for the vector score; the remainder goes to keyword score. */
  vectorWeight?: number;
}

const DEFAULT_LIMIT = 8;
const DEFAULT_VECTOR_WEIGHT = 0.75;
/** Candidates pulled from each arm before blending. */
const CANDIDATE_POOL = 40;

export async function retrieve(options: RetrieveOptions): Promise<RetrievedChunk[]> {
  const limit = options.limit ?? DEFAULT_LIMIT;
  const vectorWeight = options.vectorWeight ?? DEFAULT_VECTOR_WEIGHT;

  // Four mutually exclusive scopes, resolved to booleans and two ids:
  //  - document    → exactly one document, nothing else (Knowledge Library)
  //  - global      → no filter (management / explicit "All")
  //  - shared-only → only is_shared departments (general question, no dept yet)
  //  - department  → the selected department OR any shared department
  //
  // Document scope is resolved first and zeroes the other three, so no caller
  // can accidentally combine "this resource" with a wider search.
  const documentFilter = options.documentId ?? null;
  const isDocumentScoped = documentFilter !== null;
  const isGlobal = !isDocumentScoped && !!options.global;
  const isSharedOnly = !isDocumentScoped && !!options.sharedOnly && !isGlobal;
  const departmentFilter =
    isDocumentScoped || isGlobal || isSharedOnly ? null : (options.departmentId ?? null);

  const embedding = toVectorLiteral(await embedQuery(options.query));

  // Both arms are computed in one statement so Postgres does the blending and
  // only the final rows cross the wire.
  return (await sql`
    WITH candidates AS (
      SELECT c.id, c.document_id, c.department_id, c.content, c.heading, c.page_number,
             1 - (c.embedding <=> ${embedding}::vector) AS vector_score,
             similarity(c.content, ${options.query})     AS keyword_score
        FROM knowledge_chunks c
        JOIN knowledge_documents d ON d.id = c.document_id
        JOIN departments cd ON cd.id = c.department_id
       WHERE d.status = 'active'
         AND c.embedding IS NOT NULL
         -- Resource scope. Applied HERE, inside the candidate CTE, so it bounds
         -- the rows before ORDER BY and before LIMIT: the candidate pool is
         -- drawn from this document alone and a chunk from any other document
         -- is never ranked, never truncated against, never seen. Filtering after
         -- the LIMIT would let a neighbouring document push the real answer out
         -- of the pool. A no-op when the scope is not a resource.
         AND (${documentFilter}::uuid IS NULL OR c.document_id = ${documentFilter}::uuid)
         -- cd.is_shared is the ONLY cross-department path; no branch here ever
         -- reaches a non-selected, non-shared department.
         AND (
           ${isDocumentScoped}::bool
           OR ${isGlobal}::bool
           OR (${isSharedOnly}::bool AND cd.is_shared)
           OR (${departmentFilter}::uuid IS NOT NULL
               AND (c.department_id = ${departmentFilter}::uuid OR cd.is_shared))
         )
       ORDER BY c.embedding <=> ${embedding}::vector
       LIMIT ${CANDIDATE_POOL}
    )
    SELECT c.id AS chunk_id, c.document_id, d.title AS document_title,
           c.department_id, dep.name AS department_name,
           c.content, c.heading, c.page_number,
           c.vector_score, c.keyword_score,
           (${vectorWeight} * c.vector_score + ${1 - vectorWeight} * c.keyword_score) AS score
      FROM candidates c
      JOIN knowledge_documents d ON d.id = c.document_id
      JOIN departments dep ON dep.id = c.department_id
     ORDER BY score DESC
     LIMIT ${limit}
  `) as RetrievedChunk[];
}

/**
 * Retrieval inside one resource, for the Knowledge Library workspace.
 *
 * A named entry point rather than a bare `retrieve({ documentId })` call so the
 * isolation guarantee is greppable and there is exactly one way to ask it: this
 * signature cannot express a department, a shared bucket or a global sweep, so
 * a future edit cannot widen the scope by adding an argument at a call site.
 */
export async function retrieveWithinResource(options: {
  query: string;
  documentId: string;
  limit?: number;
}): Promise<RetrievedChunk[]> {
  return retrieve({
    query: options.query,
    documentId: options.documentId,
    limit: options.limit,
  });
}

/**
 * Retrieval scoped the way the chatbot needs it.
 *
 * When a department is selected, the search is strictly that department PLUS
 * shared knowledge — never any other department, and with NO global fallback:
 * a question neither the department nor shared can answer returns nothing, so
 * one department's question can never surface another department's content.
 *
 * A global sweep runs only when the caller explicitly asks for it (the "All
 * departments" option) or holds global access (management) — an explicit
 * choice, not a silent fallback.
 */
export async function retrieveForUser(options: {
  query: string;
  departmentId: string | null;
  globalAccess: boolean;
  explicitGlobal?: boolean;
  /** General question, no department chosen yet: search shared knowledge only. */
  sharedOnly?: boolean;
  limit?: number;
}): Promise<{ chunks: RetrievedChunk[]; scope: "department" | "global" | "shared" }> {
  // Shared-only wins: a general pre-department question searches company-wide
  // knowledge and nothing else.
  if (options.sharedOnly) {
    return {
      chunks: await retrieve({ query: options.query, sharedOnly: true, limit: options.limit }),
      scope: "shared",
    };
  }

  const wantsGlobal = options.explicitGlobal || options.globalAccess || !options.departmentId;

  if (wantsGlobal) {
    return {
      chunks: await retrieve({ query: options.query, global: true, limit: options.limit }),
      scope: "global",
    };
  }

  // Selected department + shared only. Whatever this returns — including an empty
  // result — is the answer. There is deliberately no global fallback here.
  const chunks = await retrieve({
    query: options.query,
    departmentId: options.departmentId,
    limit: options.limit,
  });
  return { chunks, scope: "department" };
}
