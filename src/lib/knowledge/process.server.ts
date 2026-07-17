import { sql, withTransaction } from "@/lib/db/client.server";
import { chunkPages, DEFAULT_CHUNK_OPTIONS, type ChunkOptions } from "./chunk";
import { embedAll, toVectorLiteral } from "./embed.server";
import type { ParsedPage } from "./parse.server";

/**
 * Document processing: text → chunks → embeddings → active.
 *
 * Runs outside the upload request. Vercel has no worker process, so there is no
 * queue service to hand this to; instead the document row is the queue
 * (status = 'processing') and this function claims and drains it. It is invoked
 * three ways, all idempotent:
 *   - via waitUntil right after upload responds (the normal path)
 *   - via the retry endpoint, for a document that failed
 *   - via the drain endpoint, for anything left behind by a killed invocation
 */

export interface ProcessResult {
  documentId: string;
  chunks: number;
  embedded: number;
  batches: number;
  retries: number;
  durationMs: number;
}

/**
 * Processes one document. Safe to call twice: chunks are deleted and rebuilt, so
 * a half-finished previous run leaves no duplicates behind.
 */
export async function processDocument(
  documentId: string,
  options: ChunkOptions = DEFAULT_CHUNK_OPTIONS,
): Promise<ProcessResult> {
  const startedAt = Date.now();

  const rows = (await sql`
    UPDATE knowledge_documents
       SET status = 'processing',
           processing_started_at = now(),
           processing_completed_at = NULL,
           processing_error = NULL,
           processing_attempts = processing_attempts + 1
     WHERE id = ${documentId}::uuid
     RETURNING id, department_id, extracted_text, page_count
  `) as Array<{
    id: string;
    department_id: string;
    extracted_text: string | null;
    page_count: number | null;
  }>;

  const document = rows[0];
  if (!document) throw new Error(`Document ${documentId} not found`);

  try {
    if (!document.extracted_text?.trim()) {
      throw new Error("Document contains no extractable text");
    }

    const pages = deserializePages(document.extracted_text);
    const chunks = chunkPages(pages, options);
    if (chunks.length === 0) throw new Error("Document produced no chunks");

    // Embeddings come first: if this throws, the previous chunks are untouched
    // and the document keeps whatever it had rather than being left empty.
    const { vectors, stats } = await embedAll(
      chunks.map((c) => c.content),
      "RETRIEVAL_DOCUMENT",
    );

    await withTransaction(async (tx) => {
      await tx.query(`DELETE FROM knowledge_chunks WHERE document_id = $1::uuid`, [documentId]);

      // One multi-row INSERT rather than a statement per chunk: a 200-chunk
      // document would otherwise be 200 round trips.
      const values: string[] = [];
      const params: unknown[] = [];
      chunks.forEach((chunk, i) => {
        const p = i * 7;
        values.push(
          `($${p + 1}::uuid,$${p + 2}::uuid,$${p + 3},$${p + 4},$${p + 5},$${p + 6},$${p + 7}::vector)`,
        );
        params.push(
          documentId,
          document.department_id,
          chunk.index,
          chunk.content,
          chunk.heading,
          chunk.pageNumber,
          toVectorLiteral(vectors[i]),
        );
      });

      await tx.query(
        `INSERT INTO knowledge_chunks
           (document_id, department_id, chunk_index, content, heading, page_number, embedding)
         VALUES ${values.join(",")}`,
        params,
      );

      await tx.query(
        `UPDATE knowledge_documents
            SET status = 'active',
                chunk_count = $2,
                processing_completed_at = now(),
                processing_error = NULL
          WHERE id = $1::uuid`,
        [documentId, chunks.length],
      );
    });

    return {
      documentId,
      chunks: chunks.length,
      embedded: stats.embedded,
      batches: stats.batches,
      retries: stats.retries,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Failure is recorded, not thrown away: the admin sees why, and retry needs
    // the attempt count. Deliberately not rethrown — callers are fire-and-forget.
    await sql`
      UPDATE knowledge_documents
         SET status = 'failed',
             processing_error = ${message.slice(0, 500)},
             processing_completed_at = now()
       WHERE id = ${documentId}::uuid
    `;
    throw error;
  }
}

/**
 * Processes documents left in 'processing' — e.g. an invocation frozen before
 * waitUntil finished. Bounded by a time budget so it cannot outlive the function.
 */
export async function drainQueue(limit = 5, budgetMs = 45_000): Promise<ProcessResult[]> {
  const deadline = Date.now() + budgetMs;
  const results: ProcessResult[] = [];

  const stale = (await sql`
    SELECT id FROM knowledge_documents
     WHERE status = 'processing'
       -- Only rows whose run plainly died; otherwise this would fight a run in flight.
       AND processing_started_at < now() - interval '5 minutes'
     ORDER BY created_at
     LIMIT ${limit}
  `) as Array<{ id: string }>;

  for (const row of stale) {
    if (Date.now() > deadline) break;
    try {
      results.push(await processDocument(row.id));
    } catch {
      // Already recorded on the row; keep draining the rest.
    }
  }
  return results;
}

/**
 * Pages are stored as text so retry can re-chunk without the original file.
 * The form feed (\f) is the conventional page separator and cannot appear in
 * extracted prose, so it round-trips safely.
 */
const PAGE_SEPARATOR = "\f";

export function serializePages(pages: ParsedPage[]): string {
  return pages.map((p) => p.text).join(PAGE_SEPARATOR);
}

function deserializePages(text: string): ParsedPage[] {
  const parts = text.split(PAGE_SEPARATOR);
  // A single part means the source had no pages (txt/md/docx) — page stays null.
  if (parts.length === 1) return [{ pageNumber: null, text: parts[0] }];
  return parts.map((t, i) => ({ pageNumber: i + 1, text: t }));
}
