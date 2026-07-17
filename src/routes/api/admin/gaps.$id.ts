import { createFileRoute } from "@tanstack/react-router";
import { requireAdmin } from "@/lib/auth/session.server";
import { api, jsonBody, routeParam } from "@/lib/http/handler";
import { ok } from "@/lib/http/errors";
import { updateGapSchema, uuid } from "@/lib/validators/admin";
import * as gaps from "@/lib/services/gaps.service";

/** /api/admin/gaps/:id — review workflow. Audit logging happens in the service. */
export const Route = createFileRoute("/api/admin/gaps/$id")({
  server: {
    handlers: {
      GET: api(async (ctx) => {
        await requireAdmin(ctx.request);
        return ok(await gaps.getById(uuid.parse(routeParam(ctx, "id"))));
      }),
      PATCH: api(async (ctx) => {
        const actor = await requireAdmin(ctx.request);
        const id = uuid.parse(routeParam(ctx, "id"));
        const input = updateGapSchema.parse(await jsonBody(ctx.request));
        return ok(await gaps.update(id, input, actor, ctx.request));
      }),
    },
  },
});
