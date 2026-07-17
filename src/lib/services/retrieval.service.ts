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
  /** Restrict to one department. Ignored when global is true. */
  departmentId?: string | null;
  /** Search every department — management, or an explicit global request. */
  global?: boolean;
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
  const departmentFilter = options.global ? null : (options.departmentId ?? null);

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
       WHERE d.status = 'active'
         AND c.embedding IS NOT NULL
         AND (${departmentFilter}::uuid IS NULL OR c.department_id = ${departmentFilter}::uuid)
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
 * Retrieval scoped the way the chatbot needs it: a department's own knowledge
 * first, falling back to a global sweep when that department has nothing
 * relevant. Management roles skip straight to global.
 */
export async function retrieveForUser(options: {
  query: string;
  departmentId: string | null;
  globalAccess: boolean;
  explicitGlobal?: boolean;
  limit?: number;
}): Promise<{ chunks: RetrievedChunk[]; scope: "department" | "global" }> {
  const wantsGlobal = options.explicitGlobal || options.globalAccess || !options.departmentId;

  if (wantsGlobal) {
    return {
      chunks: await retrieve({ query: options.query, global: true, limit: options.limit }),
      scope: "global",
    };
  }

  const departmental = await retrieve({
    query: options.query,
    departmentId: options.departmentId,
    limit: options.limit,
  });

  // Department-first, not department-only: a staff member asking something their
  // own department has no answer for should get the company answer rather than
  // a shrug. The scope is returned so the caller can say where it came from.
  if (departmental.length > 0) return { chunks: departmental, scope: "department" };
  return {
    chunks: await retrieve({ query: options.query, global: true, limit: options.limit }),
    scope: "global",
  };
}
