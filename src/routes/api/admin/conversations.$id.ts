import { createFileRoute } from "@tanstack/react-router";
import { requireAdmin } from "@/lib/auth/session.server";
import { api, routeParam } from "@/lib/http/handler";
import { ok } from "@/lib/http/errors";
import { uuid } from "@/lib/validators/admin";
import * as conversations from "@/lib/services/conversations.service";

/** /api/admin/conversations/:id — full transcript with citations per answer. */
export const Route = createFileRoute("/api/admin/conversations/$id")({
  server: {
    handlers: {
      GET: api(async (ctx) => {
        await requireAdmin(ctx.request);
        return ok(await conversations.getById(uuid.parse(routeParam(ctx, "id"))));
      }),
    },
  },
});
