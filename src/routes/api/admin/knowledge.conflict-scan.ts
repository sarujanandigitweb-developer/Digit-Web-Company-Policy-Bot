import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/session.server";
import { api, jsonBody } from "@/lib/http/handler";
import { ok } from "@/lib/http/errors";
import { getScan, startScan, stepScan } from "@/lib/knowledge/conflict-scan.server";

/**
 * /api/admin/knowledge/conflict-scan — library-wide conflict scan.
 *
 * Management only (admin and super admin), matching Users and Settings: a
 * team leader sees only their own department, so a library-wide scan is not
 * something they should run. Read-only with respect to knowledge.
 */

const stepSchema = z.object({
  action: z.literal("step"),
  scanId: z.string().uuid(),
  cursor: z.string().uuid().nullable(),
});
const startSchema = z.object({ action: z.literal("start") });

export const Route = createFileRoute("/api/admin/knowledge/conflict-scan")({
  server: {
    handlers: {
      GET: api(async ({ request }) => {
        await requireAdmin(request);
        const scanId = new URL(request.url).searchParams.get("scanId");
        const parsed = z.string().uuid().nullable().parse(scanId);
        return ok(await getScan(parsed));
      }),

      POST: api(async ({ request }) => {
        const actor = await requireAdmin(request);
        const body = await jsonBody(request);
        const action = (body as { action?: unknown } | null)?.action;
        if (action === "start") {
          startSchema.parse(body);
          return ok(await startScan(actor, request));
        }
        const step = stepSchema.parse(body);
        return ok(await stepScan(step.scanId, step.cursor, actor, request));
      }),
    },
  },
});
