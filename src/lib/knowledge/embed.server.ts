import { AppError } from "@/lib/http/errors";

/**
 * Gemini embeddings.
 *
 * 1536 dimensions, not the model's native 3072: pgvector refuses an HNSW index
 * above 2000 dims, so a 3072-wide column could not be indexed and every search
 * would become a sequential scan. gemini-embedding-001 supports Matryoshka
 * truncation, so 1536 is a supported output rather than a lossy hack.
 *
 * Groq and OpenRouter have no embedding endpoint, so unlike chat completion this
 * step has no provider fallback — it always runs on Gemini.
 */

export const EMBEDDING_DIMENSIONS = 1536;
export const EMBEDDING_MODEL = process.env.GOOGLE_EMBEDDING_MODEL ?? "gemini-embedding-001";

/** Documents and queries are embedded asymmetrically; the task type says which. */
export type EmbeddingTask = "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY";

const BATCH_SIZE = Number(process.env.EMBEDDING_BATCH_SIZE ?? 32);
const MAX_ATTEMPTS = Number(process.env.EMBEDDING_MAX_ATTEMPTS ?? 3);

export interface EmbeddingStats {
  batches: number;
  retries: number;
  embedded: number;
}

function apiKey(): string {
  const key = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!key)
    throw new AppError(500, "embedding_unconfigured", "GOOGLE_GENERATIVE_AI_API_KEY is not set");
  return key;
}

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

/** Embeds one batch, returning null when the failure is worth another attempt. */
async function embedBatch(texts: string[], task: EmbeddingTask): Promise<number[][] | null> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:batchEmbedContents?key=${apiKey()}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        requests: texts.map((text) => ({
          model: `models/${EMBEDDING_MODEL}`,
          content: { parts: [{ text }] },
          outputDimensionality: EMBEDDING_DIMENSIONS,
          taskType: task,
        })),
      }),
    },
  ).catch(() => null);

  // A network failure yields no response at all — retry rather than fail.
  if (!response) return null;

  if (!response.ok) {
    if (RETRYABLE_STATUS.has(response.status)) return null;
    const body = await response.text().catch(() => "");
    throw new AppError(
      502,
      "embedding_failed",
      `Embedding request rejected (HTTP ${response.status}): ${body.slice(0, 200)}`,
    );
  }

  const body = (await response.json()) as { embeddings?: Array<{ values: number[] }> };
  if (!body.embeddings || body.embeddings.length !== texts.length) return null;
  return body.embeddings.map((e) => e.values);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Embeds every text, in batches, retrying transient batch failures with backoff.
 *
 * Retries are per batch rather than per document: one rate-limited batch should
 * not discard the batches that already succeeded.
 */
export async function embedAll(
  texts: string[],
  task: EmbeddingTask,
): Promise<{ vectors: number[][]; stats: EmbeddingStats }> {
  const vectors: number[][] = [];
  const stats: EmbeddingStats = { batches: 0, retries: 0, embedded: 0 };

  for (let start = 0; start < texts.length; start += BATCH_SIZE) {
    const batch = texts.slice(start, start + BATCH_SIZE);
    stats.batches++;

    let result: number[][] | null = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      result = await embedBatch(batch, task);
      if (result) break;
      stats.retries++;
      if (attempt < MAX_ATTEMPTS) await sleep(500 * 2 ** (attempt - 1)); // 500ms, 1s
    }

    if (!result) {
      throw new AppError(
        502,
        "embedding_failed",
        `Embedding failed after ${MAX_ATTEMPTS} attempts (batch starting at chunk ${start})`,
      );
    }

    vectors.push(...result);
    stats.embedded += result.length;
  }

  return { vectors, stats };
}

/** Embeds a single query string for retrieval. */
export async function embedQuery(text: string): Promise<number[]> {
  const { vectors } = await embedAll([text], "RETRIEVAL_QUERY");
  return vectors[0];
}

/** pgvector's text input format. */
export function toVectorLiteral(values: number[]): string {
  return `[${values.join(",")}]`;
}
