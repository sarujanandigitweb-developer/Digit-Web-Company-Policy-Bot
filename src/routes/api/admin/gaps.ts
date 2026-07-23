import { createFileRoute } from "@tanstack/react-router";
import { requireAdminArea } from "@/lib/auth/session.server";
import { api } from "@/lib/http/handler";
import { ok } from "@/lib/http/errors";
import { listGapsQuerySchema } from "@/lib/validators/admin";
import * as gaps from "@/lib/services/gaps.service";

/** /api/admin/gaps — questions the bot answered with low confidence. */
export const Route = createFileRoute("/api/admin/gaps")({
  server: {
    handlers: {
      GET: api(async ({ request }) => {
        await requireAdminArea(request);
        const query = listGapsQuerySchema.parse(
          Object.fromEntries(new URL(request.url).searchParams),
        );
        const [{ items, total }, stats] = await Promise.all([gaps.list(query), gaps.stats()]);
        return ok({ items, page: query.page, pageSize: query.pageSize, total, stats });
      }),
    },
  },
});
