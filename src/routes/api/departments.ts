import { createFileRoute } from "@tanstack/react-router";
import { api } from "@/lib/http/handler";
import { ok } from "@/lib/http/errors";
import { sql } from "@/lib/db/client.server";

/**
 * /api/departments — the chat's department picker.
 *
 * Public, because the chat has no login. Exposes only slug and name.
 *
 * Two exclusions matter:
 *  - is_shared departments are hidden: the Shared bucket is a system department
 *    that users must never select directly; its content reaches them anyway,
 *    folded into whichever department they pick.
 *  - the old "must have its own active documents" filter is gone: shared
 *    knowledge now backs every department, so even a department with no
 *    documents of its own can answer, and so should be selectable.
 *
 * Distinct from /api/admin/departments, which is authenticated and returns
 * management fields.
 */
export const Route = createFileRoute("/api/departments")({
  server: {
    handlers: {
      GET: api(async () => {
        const items = await sql`
          SELECT d.slug, d.name
            FROM departments d
           WHERE d.status = 'active'
             AND d.is_shared = false
           ORDER BY d.name
        `;
        return ok({ items });
      }),
    },
  },
});
