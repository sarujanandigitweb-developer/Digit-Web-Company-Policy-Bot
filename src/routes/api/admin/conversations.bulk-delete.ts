import { createFileRoute } from "@tanstack/react-router";
import { requireAdminArea } from "@/lib/auth/session.server";
import { api, jsonBody } from "@/lib/http/handler";
import { ok } from "@/lib/http/errors";
import { bulkDeleteSchema } from "@/lib/validators/admin";
import * as conversations from "@/lib/services/conversations.service";

/**
 * POST /api/admin/conversations/bulk-delete — delete the selected conversations.
 *
 * A POST with a body rather than DELETE, since it carries a list of ids. Static
 * segment, so it is matched ahead of the /$id transcript route.
 */
export const Route = createFileRoute("/api/admin/conversations/bulk-delete")({
  server: {
    handlers: {
      POST: api(async ({ request }) => {
        const actor = await requireAdminArea(request);
        const { ids } = bulkDeleteSchema.parse(await jsonBody(request));
        const deleted = await conversations.deleteMany(ids, actor, request);
        return ok({ deleted });
      }),
    },
  },
});
