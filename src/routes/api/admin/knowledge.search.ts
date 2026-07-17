import { createFileRoute } from "@tanstack/react-router";
import { requireAuth } from "@/lib/auth/session.server";
import { hasGlobalKnowledgeAccess } from "@/lib/auth/permissions";
import { api } from "@/lib/http/handler";
import { ok } from "@/lib/http/errors";
import { retrieveQuerySchema } from "@/lib/validators/knowledge";
import { retrieveForUser } from "@/lib/services/retrieval.service";

/**
 * /api/admin/knowledge/search — hybrid retrieval.
 *
 * requireAuth, not requireAdmin: staff may search, but only their own
 * department unless they ask for a global search. Management sees everything.
 */
export const Route = createFileRoute("/api/admin/knowledge/search")({
  server: {
    handlers: {
      GET: api(async ({ request }) => {
        const user = await requireAuth(request);
        const q = retrieveQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));

        // A staff member cannot widen their own scope by passing departmentId.
        const globalAccess = hasGlobalKnowledgeAccess(user.role);
        const departmentId = globalAccess ? (q.departmentId ?? null) : user.departmentId;

        const { chunks, scope } = await retrieveForUser({
          query: q.q,
          departmentId,
          globalAccess: globalAccess && !q.departmentId,
          explicitGlobal: q.global && globalAccess,
          limit: q.limit,
        });
        return ok({ items: chunks, scope, query: q.q });
      }),
    },
  },
});
