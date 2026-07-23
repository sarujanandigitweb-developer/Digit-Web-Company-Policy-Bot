import { createFileRoute } from "@tanstack/react-router";
import { waitUntil } from "@vercel/functions";
import { knowledgeScope, requireAdminArea } from "@/lib/auth/session.server";
import { api, routeParam } from "@/lib/http/handler";
import { ok } from "@/lib/http/errors";
import { uuid } from "@/lib/validators/admin";
import * as knowledge from "@/lib/services/knowledge.service";
import { processDocument } from "@/lib/knowledge/process.server";

/**
 * /api/admin/knowledge/:id/retry — re-run processing for a failed document.
 *
 * Re-chunks from the stored extracted text, so a transient embedding failure is
 * recoverable without asking anyone to find and upload the file again.
 */
export const Route = createFileRoute("/api/admin/knowledge/$id/retry")({
  server: {
    handlers: {
      POST: api(async (ctx) => {
        const user = await requireAdminArea(ctx.request);
        const id = uuid.parse(routeParam(ctx, "id"));
        // Scoped: a team leader can only retry a document in their department.
        const document = await knowledge.getById(id, knowledgeScope(user));

        waitUntil(
          processDocument(id).catch((error) => {
            console.error(`[knowledge] retry failed for ${id}:`, error);
          }),
        );
        return ok({ ...document, status: "processing" }, 202);
      }),
    },
  },
});
