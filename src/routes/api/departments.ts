import { createFileRoute } from "@tanstack/react-router";
import { api } from "@/lib/http/handler";
import { ok } from "@/lib/http/errors";
import { sql } from "@/lib/db/client.server";

/**
 * /api/departments — the chat's department picker.
 *
 * Public, because the chat has no login. Exposes only what a picker needs
 * (slug and name) for departments that are active and actually have something
 * to answer from — offering a department with no content just produces a shrug.
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
             AND EXISTS (
               SELECT 1 FROM knowledge_documents kd
                WHERE kd.department_id = d.id AND kd.status = 'active'
             )
           ORDER BY d.name
        `;
        return ok({ items });
      }),
    },
  },
});
