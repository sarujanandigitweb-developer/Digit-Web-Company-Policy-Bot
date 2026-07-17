import { createFileRoute } from "@tanstack/react-router";
import { requireAdmin } from "@/lib/auth/session.server";
import { api } from "@/lib/http/handler";
import { ok } from "@/lib/http/errors";
import { sql } from "@/lib/db/client.server";
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL } from "@/lib/knowledge/embed.server";
import { DEFAULT_CHUNK_OPTIONS } from "@/lib/knowledge/chunk";
import { MAX_FILE_BYTES } from "@/lib/knowledge/parse.server";
import { CONFIDENCE_FLOOR, RETRIEVAL_ENABLED } from "@/lib/services/chat-knowledge.server";
import { PROVIDER_CHAIN, resolveProviderChain } from "@/lib/ai/providers.server";

/**
 * /api/admin/settings — read-only system configuration.
 *
 * There is no settings table: every value here is an environment variable or a
 * module constant, so exposing an editor would imply a persistence layer that
 * does not exist. This reports what the running system is actually using —
 * derived from the same constants the pipeline reads, not retyped, so it cannot
 * drift from reality.
 */
export const Route = createFileRoute("/api/admin/settings")({
  server: {
    handlers: {
      GET: api(async ({ request }) => {
        await requireAdmin(request);

        const configured = resolveProviderChain();
        const queue = (await sql`
          SELECT count(*) FILTER (WHERE status = 'processing')::int AS processing,
                 count(*) FILTER (WHERE status = 'failed')::int AS failed,
                 count(*) FILTER (WHERE status = 'processing'
                                   AND processing_started_at < now() - interval '5 minutes')::int
                   AS stalled
            FROM knowledge_documents
        `) as Array<{ processing: number; failed: number; stalled: number }>;

        return ok({
          knowledge: {
            source: RETRIEVAL_ENABLED ? "database (retrieval)" : "transcript (legacy Drive doc)",
            embedding_model: EMBEDDING_MODEL,
            embedding_dimensions: EMBEDDING_DIMENSIONS,
            chunk_size: DEFAULT_CHUNK_OPTIONS.size,
            chunk_overlap: DEFAULT_CHUNK_OPTIONS.overlap,
            confidence_floor: CONFIDENCE_FLOOR,
            max_upload_bytes: MAX_FILE_BYTES,
            supported_types: ["pdf", "docx", "txt", "md"],
          },
          // Keys are never returned — only whether each provider is configured.
          providers: PROVIDER_CHAIN.map((p) => ({
            id: p.id,
            model: process.env[p.modelEnv] || p.defaultModel,
            configured: configured.some((c) => c.id === p.id),
            order: PROVIDER_CHAIN.indexOf(p) + 1,
          })),
          queue: queue[0],
          runtime: {
            node: process.version,
            environment: process.env.NODE_ENV ?? "development",
          },
        });
      }),
    },
  },
});
