import { createFileRoute } from "@tanstack/react-router";
import { knowledgeScope, requireAdminArea } from "@/lib/auth/session.server";
import { api } from "@/lib/http/handler";
import { ok } from "@/lib/http/errors";
import * as library from "@/lib/services/library.service";

/**
 * /api/admin/library/tree — the Knowledge Library hierarchy.
 *
 * Authenticated console access, same gate as every other knowledge surface. The
 * folder tree is company-wide; the resources inside it are filtered to the
 * caller's department scope, so a team leader browsing another department's
 * branch sees the structure but nothing to open.
 */
export const Route = createFileRoute("/api/admin/library/tree")({
  server: {
    handlers: {
      GET: api(async ({ request }) => {
        const user = await requireAdminArea(request);
        return ok(await library.tree(knowledgeScope(user)));
      }),
    },
  },
});
