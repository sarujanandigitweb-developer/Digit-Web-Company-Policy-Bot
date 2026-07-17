import { createFileRoute } from "@tanstack/react-router";
import { requireAdmin } from "@/lib/auth/session.server";
import { api, jsonBody } from "@/lib/http/handler";
import { ok } from "@/lib/http/errors";
import { createUserSchema, listUsersQuerySchema } from "@/lib/validators/admin";
import * as users from "@/lib/services/users.service";

/**
 * /api/admin/users — collection routes.
 *
 * Both are guarded at admin level; which roles the caller may actually create is
 * decided in the service via assignableRoles, so the rule lives with the rest of
 * the permission model rather than being restated per route.
 */
export const Route = createFileRoute("/api/admin/users")({
  server: {
    handlers: {
      GET: api(async ({ request }) => {
        await requireAdmin(request);
        const query = listUsersQuerySchema.parse(
          Object.fromEntries(new URL(request.url).searchParams),
        );
        const { items, total } = await users.list(query);
        return ok({ items, page: query.page, pageSize: query.pageSize, total });
      }),

      POST: api(async ({ request }) => {
        const actor = await requireAdmin(request);
        const input = createUserSchema.parse(await jsonBody(request));
        return ok(await users.create(input, actor, request), 201);
      }),
    },
  },
});
