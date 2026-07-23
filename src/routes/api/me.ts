import { createFileRoute } from "@tanstack/react-router";
import { requireAuth } from "@/lib/auth/session.server";
import { api } from "@/lib/http/handler";
import { ok } from "@/lib/http/errors";

/**
 * /api/me — the caller's own identity and role.
 *
 * requireAuth, not requireAdmin: every signed-in account can read its own
 * profile. The admin console uses this to decide which navigation to show —
 * team leaders see every page except Users and Settings — without having to hit
 * a users endpoint they may not be allowed to call.
 */
export const Route = createFileRoute("/api/me")({
  server: {
    handlers: {
      GET: api(async ({ request }) => {
        const user = await requireAuth(request);
        return ok({
          userId: user.userId,
          email: user.email,
          fullName: user.fullName,
          role: user.role,
          departmentId: user.departmentId,
          status: user.status,
        });
      }),
    },
  },
});
