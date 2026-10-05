import { sql } from "@/lib/db/client.server";
import { embedQuery, toVectorLiteral } from "@/lib/knowledge/embed.server";

/**
 * Tells the chatbot when approved knowledge disagrees about the question.
 *
 * Two sources of known conflicts:
 *  - the library scan (knowledge_pair_comparisons, relation 'conflict'), and
 *  - a per-document review still in progress (knowledge_chunk_reviews, whose
 *    flagged passages are hidden from retrieval until published).
 *
 * Only titles leave this module, and only for conflicts where BOTH sides fall
 * inside the request's department scope, so a department user is never told
 * that another department's document exists. Passage content is never returned.
 */

export interface OpenConflict {
  titleA: string;
  titleB: string;
}

export type ConflictScope = {
  question: string;
  departmentId: string | null;
  globalSearch: boolean;
  sharedOnly?: boolean;
  /** Minimum passage similarity to the question for a conflict to be disclosed. */
  threshold: number;
};

/** Relevant, in-scope conflicts for this question, at most three. */
export async function openConflicts(scope: ConflictScope): Promise<OpenConflict[]> {
  const mode = scope.sharedOnly
    ? "shared"
    : scope.globalSearch || !scope.departmentId
      ? "global"
      : "department";
  const departmentId = scope.departmentId;

  // Cheap existence check first, so a question with no open conflicts never pays
  // for a query embedding.
  const anyOpen = (await sql`
    WITH pairs AS (
      SELECT p.chunk_low AS a, p.chunk_high AS b
        FROM knowledge_pair_comparisons p WHERE p.relation = 'conflict'
      UNION
      SELECT r.chunk_id, (m->>'chunk_id')::uuid
        FROM knowledge_chunk_reviews r
        JOIN knowledge_documents rd ON rd.id = r.document_id
        CROSS JOIN LATERAL jsonb_array_elements(r.matches) m
       WHERE rd.review_origin = 'existing' AND rd.review_state <> 'published'
         AND rd.status IN ('active', 'pending_review') AND m->>'relation' = 'conflict'
    )
    SELECT 1 FROM pairs
     WHERE EXISTS (SELECT 1 FROM knowledge_chunks x WHERE x.id = pairs.a AND x.is_searchable)
     LIMIT 1
  `) as unknown[];
  if (anyOpen.length === 0) return [];

  const embedding = toVectorLiteral(await embedQuery(scope.question));
  const rows = (await sql`
    WITH pairs AS (
      SELECT p.chunk_low AS a, p.chunk_high AS b
        FROM knowledge_pair_comparisons p WHERE p.relation = 'conflict'
      UNION
      SELECT r.chunk_id, (m->>'chunk_id')::uuid
        FROM knowledge_chunk_reviews r
        JOIN knowledge_documents rd ON rd.id = r.document_id
        CROSS JOIN LATERAL jsonb_array_elements(r.matches) m
       WHERE rd.review_origin = 'existing' AND rd.review_state <> 'published'
         AND rd.status IN ('active', 'pending_review') AND m->>'relation' = 'conflict'
    )
    SELECT da.title AS title_a, db.title AS title_b,
           GREATEST(1 - (ca.embedding <=> ${embedding}::vector),
                    1 - (cb.embedding <=> ${embedding}::vector)) AS relevance
      FROM pairs p
      JOIN knowledge_chunks ca ON ca.id = p.a AND ca.is_searchable AND ca.embedding IS NOT NULL
      JOIN knowledge_chunks cb ON cb.id = p.b AND cb.is_searchable AND cb.embedding IS NOT NULL
      JOIN knowledge_documents da ON da.id = ca.document_id AND da.status = 'active'
      JOIN knowledge_documents db ON db.id = cb.document_id AND db.status = 'active'
      JOIN departments depa ON depa.id = ca.department_id
      JOIN departments depb ON depb.id = cb.department_id
     WHERE (
             ${mode} = 'global'
          OR (${mode} = 'shared' AND depa.is_shared AND depb.is_shared)
          OR (${mode} = 'department'
              AND (depa.id = ${departmentId}::uuid OR depa.is_shared)
              AND (depb.id = ${departmentId}::uuid OR depb.is_shared))
           )
       AND GREATEST(1 - (ca.embedding <=> ${embedding}::vector),
                    1 - (cb.embedding <=> ${embedding}::vector)) >= ${scope.threshold}
     ORDER BY relevance DESC
     LIMIT 10
  `) as Array<{ title_a: string; title_b: string; relevance: number }>;

  const seen = new Set<string>();
  const out: OpenConflict[] = [];
  for (const row of rows) {
    const key = [row.title_a, row.title_b].sort().join("\u0000");
    if (seen.has(key) || row.title_a === row.title_b) continue;
    seen.add(key);
    out.push({ titleA: row.title_a, titleB: row.title_b });
    if (out.length === 3) break;
  }
  return out;
}

/** Document titles are admin-entered; flatten them so they cannot break the prompt. */
function safeTitle(title: string): string {
  return title.replace(/[\r\n"]/g, " ").slice(0, 120);
}

/** The instruction appended to the chatbot's system prompt. Empty when there is no conflict. */
export function conflictInstruction(conflicts: OpenConflict[]): string {
  if (conflicts.length === 0) return "";
  const lines = conflicts
    .map((c) => `- "${safeTitle(c.titleA)}" and "${safeTitle(c.titleB)}"`)
    .join("\n");
  return [
    "UNRESOLVED CONFLICT: approved sources disagree on part of this question:",
    lines,
    "For this question, do not choose one source and do not state either version as the rule.",
    "Say that approved sources disagree on this point and that an administrator must confirm the answer.",
    "You may name these documents, but do not quote or summarise their conflicting passages.",
  ].join("\n");
}

/** Used when the conflict check itself fails: stay cautious rather than answer as if nothing is open. */
export const CONFLICT_CHECK_FAILED_INSTRUCTION =
  "NOTE: the conflict check could not run. If the excerpts could disagree with each other on this question, say so and ask the user to confirm with an administrator rather than picking one version.";
