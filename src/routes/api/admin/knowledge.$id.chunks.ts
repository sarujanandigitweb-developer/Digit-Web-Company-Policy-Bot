import { createFileRoute } from "@tanstack/react-router";
import { knowledgeScope, requireAdminArea } from "@/lib/auth/session.server";
import { api, routeParam } from "@/lib/http/handler";
import { ok } from "@/lib/http/errors";
import { uuid } from "@/lib/validators/admin";
import { chunksQuerySchema } from "@/lib/validators/knowledge";
import * as knowledge from "@/lib/services/knowledge.service";

/** /api/admin/knowledge/:id/chunks — inspect what retrieval actually sees. */
export const Route = createFileRoute("/api/admin/knowledge/$id/chunks")({
  server: {
    handlers: {
      GET: api(async (ctx) => {
        const user = await requireAdminArea(ctx.request);
        const id = uuid.parse(routeParam(ctx, "id"));
        const q = chunksQuerySchema.parse(
          Object.fromEntries(new URL(ctx.request.url).searchParams),
        );
        const { items, total } = await knowledge.listChunks(
          id,
          q.limit,
          q.offset,
          knowledgeScope(user),
        );
        return ok({ items, total, limit: q.limit, offset: q.offset });
      }),
    },
  },
});
