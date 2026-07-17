import { createFileRoute } from "@tanstack/react-router";
import { requireAdmin } from "@/lib/auth/session.server";
import { api } from "@/lib/http/handler";
import { ok } from "@/lib/http/errors";
import { sql } from "@/lib/db/client.server";

/**
 * /api/admin/system/status — health of the four dependencies the admin cares about.
 *
 * Each check is real: a query, a HEAD against the JWKS, a HEAD against the
 * embedding API. A status card that always reads "Healthy" is worse than none.
 */
type Health = "healthy" | "warning" | "offline";
interface Check {
  name: string;
  status: Health;
  detail: string;
  latency_ms: number | null;
}

async function timed<T>(fn: () => Promise<T>): Promise<[T | null, number, string | null]> {
  const t = Date.now();
  try {
    return [await fn(), Date.now() - t, null];
  } catch (e) {
    return [null, Date.now() - t, e instanceof Error ? e.message : String(e)];
  }
}

export const Route = createFileRoute("/api/admin/system/status")({
  server: {
    handlers: {
      GET: api(async ({ request }) => {
        await requireAdmin(request);

        const [dbRes, dbMs, dbErr] = await timed(() => sql`SELECT 1 AS ok`);
        const database: Check = {
          name: "Database",
          status: dbErr ? "offline" : dbMs > 1000 ? "warning" : "healthy",
          detail: dbErr ?? `Neon Postgres responding in ${dbMs}ms`,
          latency_ms: dbMs,
        };
        void dbRes;

        const authUrl = process.env.NEON_AUTH_URL;
        const [, authMs, authErr] = await timed(async () => {
          const r = await fetch(`${authUrl}/.well-known/jwks.json`, {
            signal: AbortSignal.timeout(5000),
          });
          if (!r.ok) throw new Error(`JWKS returned HTTP ${r.status}`);
        });
        const authentication: Check = {
          name: "Authentication",
          status: !authUrl ? "offline" : authErr ? "offline" : "healthy",
          detail: !authUrl
            ? "NEON_AUTH_URL is not configured"
            : (authErr ?? "Neon Auth JWKS reachable"),
          latency_ms: authMs,
        };

        const key = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
        const model = process.env.GOOGLE_EMBEDDING_MODEL ?? "gemini-embedding-001";
        const [, embedMs, embedErr] = await timed(async () => {
          const r = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}?key=${key}`,
            { signal: AbortSignal.timeout(5000) },
          );
          if (!r.ok) throw new Error(`Embedding model check returned HTTP ${r.status}`);
        });
        const embedding: Check = {
          name: "Embedding Service",
          status: !key ? "offline" : embedErr ? "offline" : "healthy",
          detail: !key
            ? "GOOGLE_GENERATIVE_AI_API_KEY is not set"
            : (embedErr ?? `${model} reachable`),
          latency_ms: embedMs,
        };

        // Queue health is the stuck-document count: rows sitting in 'processing'
        // long after any live run would have finished.
        const queueRows = (await sql`
          SELECT count(*) FILTER (WHERE status = 'processing')::int AS processing,
                 count(*) FILTER (WHERE status = 'processing'
                                   AND processing_started_at < now() - interval '5 minutes')::int AS stuck,
                 count(*) FILTER (WHERE status = 'failed')::int AS failed
            FROM knowledge_documents
        `) as Array<{ processing: number; stuck: number; failed: number }>;
        const q = queueRows[0];
        const queue: Check = {
          name: "Queue",
          status: q.stuck > 0 ? "warning" : "healthy",
          detail:
            q.stuck > 0
              ? `${q.stuck} document(s) stalled — retry them`
              : q.processing > 0
                ? `${q.processing} document(s) processing`
                : "Idle",
          latency_ms: null,
        };

        const checks = [database, authentication, embedding, queue];
        const overall: Health = checks.some((c) => c.status === "offline")
          ? "offline"
          : checks.some((c) => c.status === "warning")
            ? "warning"
            : "healthy";

        return ok({ overall, checks, queue_depth: q.processing, failed_documents: q.failed });
      }),
    },
  },
});
