import { createFileRoute } from "@tanstack/react-router";
import { requireAdmin } from "@/lib/auth/session.server";
import { api } from "@/lib/http/handler";
import { ok } from "@/lib/http/errors";
import { uuid } from "@/lib/validators/admin";
import * as knowledge from "@/lib/services/knowledge.service";

/** /api/admin/knowledge/stats — dashboard counters. */
export const Route = createFileRoute("/api/admin/knowledge/stats")({
  server: {
    handlers: {
      GET: api(async ({ request }) => {
        await requireAdmin(request);
        const raw = new URL(request.url).searchParams.get("departmentId");
        const departmentId = raw ? uuid.parse(raw) : undefined;
        return ok(await knowledge.stats(departmentId));
      }),
    },
  },
});
