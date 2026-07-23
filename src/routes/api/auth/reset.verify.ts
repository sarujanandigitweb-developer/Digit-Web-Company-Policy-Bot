import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { api, jsonBody } from "@/lib/http/handler";
import { ok } from "@/lib/http/errors";
import * as reset from "@/lib/services/password-reset.service";

const schema = z.object({
  email: z.string().email(),
  code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code"),
});

/**
 * POST /api/auth/reset/verify — check a code without spending it.
 *
 * Lets the Verify screen validate before the user picks a new password. Returns
 * { valid: boolean }; a wrong guess counts toward the code's lockout.
 */
export const Route = createFileRoute("/api/auth/reset/verify")({
  server: {
    handlers: {
      POST: api(async ({ request }) => {
        const { email, code } = schema.parse(await jsonBody(request));
        const result = await reset.verifyCode(email, code);
        return ok({ valid: result === "valid" });
      }),
    },
  },
});
