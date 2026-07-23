import { createFileRoute } from "@tanstack/react-router";
import { knowledgeScope, requireAdminArea } from "@/lib/auth/session.server";
import { api } from "@/lib/http/handler";
import { ok } from "@/lib/http/errors";
import { uuid } from "@/lib/validators/admin";
import * as knowledge from "@/lib/services/knowledge.service";

/** /api/admin/knowledge/stats — dashboard counters. */
export const Route = createFileRoute("/api/admin/knowledge/stats")({
  server: {
    handlers: {
      GET: api(async ({ request }) => {
        const user = await requireAdminArea(request);
        // Team leaders see counters for their own department only; the requested
        // departmentId is ignored for them.
        const scope = knowledgeScope(user);
        const raw = new URL(request.url).searchParams.get("departmentId");
        const departmentId = scope ?? (raw ? uuid.parse(raw) : undefined);
        return ok(await knowledge.stats(departmentId));
      }),
    },
  },
});
