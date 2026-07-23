import { createFileRoute } from "@tanstack/react-router";
import { requireAdminArea } from "@/lib/auth/session.server";
import { api, jsonBody } from "@/lib/http/handler";
import { ok } from "@/lib/http/errors";
import { bulkDeleteSchema } from "@/lib/validators/admin";
import * as gaps from "@/lib/services/gaps.service";

/** POST /api/admin/gaps/bulk-delete — delete the selected knowledge gaps. */
export const Route = createFileRoute("/api/admin/gaps/bulk-delete")({
  server: {
    handlers: {
      POST: api(async ({ request }) => {
        const actor = await requireAdminArea(request);
        const { ids } = bulkDeleteSchema.parse(await jsonBody(request));
        const deleted = await gaps.deleteMany(ids, actor, request);
        return ok({ deleted });
      }),
    },
  },
});
