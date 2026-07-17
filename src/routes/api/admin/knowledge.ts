import { createFileRoute } from "@tanstack/react-router";
import { waitUntil } from "@vercel/functions";
import { requireAdmin } from "@/lib/auth/session.server";
import { api } from "@/lib/http/handler";
import { BadRequest, ok } from "@/lib/http/errors";
import { listDocumentsQuerySchema, uploadFieldsSchema } from "@/lib/validators/knowledge";
import * as knowledge from "@/lib/services/knowledge.service";
import { processDocument } from "@/lib/knowledge/process.server";

/**
 * /api/admin/knowledge — list and upload.
 *
 * Upload responds as soon as the file is stored and queued. Chunking and
 * embedding run under waitUntil: the response is already sent, but the function
 * stays alive to finish the work. Anything that outlives the invocation is
 * picked up by the drain endpoint, so a killed run delays a document rather than
 * losing it.
 */
export const Route = createFileRoute("/api/admin/knowledge")({
  server: {
    handlers: {
      GET: api(async ({ request }) => {
        await requireAdmin(request);
        const query = listDocumentsQuerySchema.parse(
          Object.fromEntries(new URL(request.url).searchParams),
        );
        const { items, total } = await knowledge.list(query);
        return ok({ items, page: query.page, pageSize: query.pageSize, total });
      }),

      POST: api(async ({ request }) => {
        const actor = await requireAdmin(request);

        const form = await request.formData().catch(() => null);
        if (!form) throw BadRequest("Expected multipart/form-data with a 'file' field");

        const file = form.get("file");
        if (!(file instanceof File)) throw BadRequest("Missing 'file' field");

        const fields = uploadFieldsSchema.parse({
          title: form.get("title") ?? undefined,
          description: form.get("description") ?? undefined,
          departmentId: form.get("departmentId") ?? undefined,
          replacesId: form.get("replacesId") ?? undefined,
        });

        const document = await knowledge.upload(
          {
            fileName: file.name,
            buffer: Buffer.from(await file.arrayBuffer()),
            title: fields.title,
            description: fields.description,
            departmentId: fields.departmentId,
            replacesId: fields.replacesId,
          },
          actor,
          request,
        );

        // Fire-and-forget by design: processing failure is recorded on the row
        // and surfaced via status, not by failing an upload that already succeeded.
        waitUntil(
          processDocument(document.id).catch((error) => {
            console.error(`[knowledge] processing failed for ${document.id}:`, error);
          }),
        );

        return ok(document, 202); // 202: stored and queued, not yet retrievable.
      }),
    },
  },
});
