import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { api, jsonBody } from "@/lib/http/handler";
import { ok } from "@/lib/http/errors";
import { originOf } from "@/lib/auth/neon-auth.server";
import * as reset from "@/lib/services/password-reset.service";

const schema = z.object({
  email: z.string().email(),
  code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

/**
 * POST /api/auth/reset/confirm — spend the code and set the new password.
 *
 * The origin is forwarded to Neon Auth (it validates it against trusted_origins
 * when the service account signs in). A bad code or weak password 400s.
 */
export const Route = createFileRoute("/api/auth/reset/confirm")({
  server: {
    handlers: {
      POST: api(async ({ request }) => {
        const { email, code, password } = schema.parse(await jsonBody(request));
        await reset.resetPassword(email, code, password, originOf(request));
        return ok({ reset: true });
      }),
    },
  },
});
