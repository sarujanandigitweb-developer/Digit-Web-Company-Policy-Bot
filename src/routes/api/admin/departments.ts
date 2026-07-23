import { createFileRoute } from "@tanstack/react-router";
import { requireAdminArea, requireSuperAdmin } from "@/lib/auth/session.server";
import { api, jsonBody } from "@/lib/http/handler";
import { ok } from "@/lib/http/errors";
import { createDepartmentSchema, listQuerySchema } from "@/lib/validators/admin";
import * as departments from "@/lib/services/departments.service";

/**
 * /api/admin/departments — collection routes.
 *
 * Handlers stay thin on purpose: guard, validate, delegate. All error mapping is
 * in `api()`, and all audit logging is inside the service's transaction.
 */
export const Route = createFileRoute("/api/admin/departments")({
  server: {
    handlers: {
      GET: api(async ({ request }) => {
        await requireAdminArea(request);
        const query = listQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
        const { items, total } = await departments.list(query);
        return ok({ items, page: query.page, pageSize: query.pageSize, total });
      }),

      // Creating a department is structural, so it is super-admin only —
      // admins manage the contents of departments, not the set of them.
      POST: api(async ({ request }) => {
        const actor = await requireSuperAdmin(request);
        const input = createDepartmentSchema.parse(await jsonBody(request));
        const created = await departments.create(input, actor, request);
        return ok(created, 201);
      }),
    },
  },
});
