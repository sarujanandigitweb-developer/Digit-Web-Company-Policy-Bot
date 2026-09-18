import { timingSafeEqual } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";
import { api } from "@/lib/http/handler";
import { ok, Unauthorized } from "@/lib/http/errors";
import { purgeOlderThan } from "@/lib/services/conversations.service";

/** Vercel cron authentication is separate from admin browser sessions. */
export const Route = createFileRoute("/api/cron/conversations")({
  server: {
    handlers: {
      GET: api(async ({ request }) => {
        const secret = process.env.CRON_SECRET;
        if (!secret?.trim()) throw Unauthorized();
        const expected = Buffer.from(`Bearer ${secret}`);
        const provided = Buffer.from(request.headers.get("authorization") ?? "");
        if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
          throw Unauthorized();
        }
        const response = ok(await purgeOlderThan());
        response.headers.set("Cache-Control", "no-store");
        return response;
      }),
    },
  },
});
