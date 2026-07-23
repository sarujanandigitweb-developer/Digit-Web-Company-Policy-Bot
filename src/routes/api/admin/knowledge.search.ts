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
 * requireAuth, not requireAdmin: any signed-in console user may search. Every
 * console role (team leader, admin, super admin) has global knowledge access, so
 * the department filter here is an opt-in narrowing, not a permission boundary.
 */
export const Route = createFileRoute("/api/admin/knowledge/search")({
  server: {
    handlers: {
      GET: api(async ({ request }) => {
        const user = await requireAuth(request);
        const q = retrieveQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));

        // Everyone with a console role searches globally; a departmentId only
        // narrows the results, it never widens them beyond what the role allows.
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
