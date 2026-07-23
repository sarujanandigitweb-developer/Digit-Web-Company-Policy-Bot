import { createFileRoute } from "@tanstack/react-router";
import { requireAdminArea } from "@/lib/auth/session.server";
import { api } from "@/lib/http/handler";
import { ok } from "@/lib/http/errors";
import { listConversationsQuerySchema } from "@/lib/validators/admin";
import * as conversations from "@/lib/services/conversations.service";

/** /api/admin/conversations — anonymous chat sessions, newest activity first. */
export const Route = createFileRoute("/api/admin/conversations")({
  server: {
    handlers: {
      GET: api(async ({ request }) => {
        await requireAdminArea(request);
        const query = listConversationsQuerySchema.parse(
          Object.fromEntries(new URL(request.url).searchParams),
        );
        const { items, total } = await conversations.list(query);
        return ok({ items, page: query.page, pageSize: query.pageSize, total });
      }),
    },
  },
});
