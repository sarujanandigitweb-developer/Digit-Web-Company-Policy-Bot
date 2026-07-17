import { createFileRoute } from "@tanstack/react-router";
import { requireAdmin } from "@/lib/auth/session.server";
import { api } from "@/lib/http/handler";
import { ok } from "@/lib/http/errors";
import { sql } from "@/lib/db/client.server";

/**
 * /api/admin/analytics/knowledge — series behind the dashboard charts.
 *
 * Added because the charts had no data source and inventing one was not an
 * option. Every series is derived from rows that already exist; nothing is
 * sampled or estimated.
 *
 * generate_series fills days with no uploads so the x-axis stays continuous —
 * a line that skips empty days misrepresents the trend.
 */
export const Route = createFileRoute("/api/admin/analytics/knowledge")({
  server: {
    handlers: {
      GET: api(async ({ request }) => {
        await requireAdmin(request);
        const raw = Number(new URL(request.url).searchParams.get("days") ?? 30);
        const days = Math.min(Math.max(Number.isFinite(raw) ? raw : 30, 7), 90);

        const [byDepartment, byStatus, overTime, retries] = await Promise.all([
          sql`
            SELECT dep.name AS department,
                   count(d.id)::int AS documents,
                   COALESCE(sum(d.chunk_count), 0)::int AS chunks
              FROM departments dep
              LEFT JOIN knowledge_documents d
                     ON d.department_id = dep.id AND d.status <> 'archived'
             GROUP BY dep.name
             ORDER BY dep.name
          `,
          sql`
            SELECT status::text AS status, count(*)::int AS count
              FROM knowledge_documents
             GROUP BY status
             ORDER BY count DESC
          `,
          sql`
            SELECT to_char(s.day, 'YYYY-MM-DD') AS date,
                   COALESCE(u.uploads, 0)::int AS uploads,
                   COALESCE(u.chunks, 0)::int AS chunks,
                   COALESCE(u.embeddings, 0)::int AS embeddings
              -- Aliased as s(day): an unaliased generate_series collides with
              -- the subquery's own "day" and the join condition is ambiguous.
              FROM generate_series(
                     (now() - make_interval(days => ${days}))::date, now()::date, '1 day'
                   ) AS s(day)
              LEFT JOIN (
                SELECT d.created_at::date AS day,
                       count(*)::int AS uploads,
                       COALESCE(sum(d.chunk_count), 0)::int AS chunks,
                       COALESCE(sum((SELECT count(*) FROM knowledge_chunks c
                                      WHERE c.document_id = d.id AND c.embedding IS NOT NULL)), 0)::int
                         AS embeddings
                  FROM knowledge_documents d
                 WHERE d.created_at >= now() - make_interval(days => ${days})
                 GROUP BY d.created_at::date
              ) u ON u.day = s.day
             ORDER BY s.day
          `,
          sql`
            SELECT to_char(s.day, 'YYYY-MM-DD') AS date,
                   COALESCE(r.retried, 0)::int AS retried,
                   COALESCE(r.failed, 0)::int AS failed
              FROM generate_series(
                     (now() - make_interval(days => ${days}))::date, now()::date, '1 day'
                   ) AS s(day)
              LEFT JOIN (
                -- attempts > 1 means the document needed at least one retry.
                SELECT COALESCE(processing_completed_at, updated_at)::date AS day,
                       count(*) FILTER (WHERE processing_attempts > 1)::int AS retried,
                       count(*) FILTER (WHERE status = 'failed')::int AS failed
                  FROM knowledge_documents
                 WHERE COALESCE(processing_completed_at, updated_at) >= now() - make_interval(days => ${days})
                 GROUP BY COALESCE(processing_completed_at, updated_at)::date
              ) r ON r.day = s.day
             ORDER BY s.day
          `,
        ]);

        return ok({ days, byDepartment, byStatus, overTime, retries });
      }),
    },
  },
});
