import { createFileRoute } from "@tanstack/react-router";
import { knowledgeScope, requireAdminArea } from "@/lib/auth/session.server";
import { api, routeParam } from "@/lib/http/handler";
import { ok } from "@/lib/http/errors";
import { resourceIdSchema } from "@/lib/validators/library";
import * as library from "@/lib/services/library.service";

/**
 * /api/admin/library/resources/:id — one resource, ready to read.
 *
 * The body comes from the text the ingestion pipeline already extracted and
 * stored. The original file is never fetched, so opening a resource costs one
 * row read and works identically on Vercel, where there is no local filesystem
 * to cache anything in.
 */
export const Route = createFileRoute("/api/admin/library/resources/$id")({
  server: {
    handlers: {
      GET: api(async (ctx) => {
        const user = await requireAdminArea(ctx.request);
        const id = resourceIdSchema.parse(routeParam(ctx, "id"));
        return ok(await library.getResource(id, knowledgeScope(user)));
      }),
    },
  },
});
