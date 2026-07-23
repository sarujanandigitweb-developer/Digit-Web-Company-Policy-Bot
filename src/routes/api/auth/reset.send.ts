import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { api, jsonBody } from "@/lib/http/handler";
import { ok } from "@/lib/http/errors";
import * as reset from "@/lib/services/password-reset.service";

const schema = z.object({ email: z.string().email() });

/**
 * POST /api/auth/reset/send — email a 6-digit reset code.
 *
 * Public and deliberately uniform: it always answers { sent: true } so the
 * response can't be used to discover which emails have accounts. The service
 * enforces cooldown, hourly caps, and silence for unknown addresses.
 */
export const Route = createFileRoute("/api/auth/reset/send")({
  server: {
    handlers: {
      POST: api(async ({ request }) => {
        const { email } = schema.parse(await jsonBody(request));
        await reset.requestReset(email);
        return ok({ sent: true });
      }),
    },
  },
});
