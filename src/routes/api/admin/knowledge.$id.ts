import { createFileRoute } from "@tanstack/react-router";
import { requireAdmin, requireSuperAdmin } from "@/lib/auth/session.server";
import { api, jsonBody, routeParam } from "@/lib/http/handler";
import { ok } from "@/lib/http/errors";
import { uuid } from "@/lib/validators/admin";
import { setStatusSchema } from "@/lib/validators/knowledge";
import * as knowledge from "@/lib/services/knowledge.service";

/** /api/admin/knowledge/:id — details, lifecycle, delete. */
export const Route = createFileRoute("/api/admin/knowledge/$id")({
  server: {
    handlers: {
      GET: api(async (ctx) => {
        await requireAdmin(ctx.request);
        return ok(await knowledge.getById(uuid.parse(routeParam(ctx, "id"))));
      }),

      PATCH: api(async (ctx) => {
        const actor = await requireAdmin(ctx.request);
        const id = uuid.parse(routeParam(ctx, "id"));
        const { status } = setStatusSchema.parse(await jsonBody(ctx.request));
        return ok(await knowledge.setStatus(id, status, actor, ctx.request));
      }),

      // Deleting destroys the chunks and the citations pointing at them; archive
      // is the reversible option, so deletion is super-admin only.
      DELETE: api(async (ctx) => {
        const actor = await requireSuperAdmin(ctx.request);
        await knowledge.remove(uuid.parse(routeParam(ctx, "id")), actor, ctx.request);
        return new Response(null, { status: 204 });
      }),
    },
  },
});
