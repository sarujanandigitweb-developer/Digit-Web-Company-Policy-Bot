import { createFileRoute } from "@tanstack/react-router";
import { requireAdminArea } from "@/lib/auth/session.server";
import { api } from "@/lib/http/handler";
import { ok } from "@/lib/http/errors";
import { sql } from "@/lib/db/client.server";

/**
 * /api/admin/activity — the dashboard's Recent Activity feed.
 *
 * Added for the UI: audit_logs already recorded everything, but nothing exposed
 * it. Reads only; no new business logic.
 */
export const Route = createFileRoute("/api/admin/activity")({
  server: {
    handlers: {
      GET: api(async ({ request }) => {
        await requireAdminArea(request);
        const limit = Math.min(Number(new URL(request.url).searchParams.get("limit") ?? 15), 50);

        const items = await sql`
          SELECT a.id, a.action, a.table_name, a.record_id, a.created_at,
                 p.full_name AS actor_name,
                 COALESCE(a.new_value->>'title', a.new_value->>'full_name',
                          a.old_value->>'title', a.old_value->>'full_name',
                          a.new_value->>'name',  a.old_value->>'name') AS subject
            FROM audit_logs a
            LEFT JOIN profiles p ON p.user_id = a.actor_id
           ORDER BY a.created_at DESC
           LIMIT ${limit}
        `;
        return ok({ items });
      }),
    },
  },
});
