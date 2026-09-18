import { createFileRoute } from "@tanstack/react-router";
import { requireAdminArea } from "@/lib/auth/session.server";
import { api } from "@/lib/http/handler";
import { uuid } from "@/lib/validators/admin";
import { Forbidden, ok } from "@/lib/http/errors";
import * as library from "@/lib/services/library.service";

/**
 * /api/admin/library/folders — flat "Amazon / Model_01 / 01. Title" labels for
 * the upload form's location picker. Separate from /tree because the form needs
 * a list to choose from, not a hierarchy to render.
 */
export const Route = createFileRoute("/api/admin/library/folders")({
  server: {
    handlers: {
      GET: api(async ({ request }) => {
        const user = await requireAdminArea(request);
        const departmentId = uuid.parse(new URL(request.url).searchParams.get("departmentId"));
        if (user.role === "team_leader" && departmentId !== user.departmentId) {
          throw Forbidden();
        }
        return ok({ items: await library.folderOptions(departmentId) });
      }),
    },
  },
});
