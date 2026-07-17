import { createFileRoute } from "@tanstack/react-router";
import { requireAdmin, requireSuperAdmin } from "@/lib/auth/session.server";
import { api, jsonBody, routeParam } from "@/lib/http/handler";
import { ok } from "@/lib/http/errors";
import { updateDepartmentSchema, uuid } from "@/lib/validators/admin";
import * as departments from "@/lib/services/departments.service";

/** /api/admin/departments/:id — single-resource routes. */
export const Route = createFileRoute("/api/admin/departments/$id")({
  server: {
    handlers: {
      GET: api(async (ctx) => {
        await requireAdmin(ctx.request);
        const id = uuid.parse(routeParam(ctx, "id"));
        return ok(await departments.getById(id));
      }),

      PATCH: api(async (ctx) => {
        const actor = await requireAdmin(ctx.request);
        const id = uuid.parse(routeParam(ctx, "id"));
        const input = updateDepartmentSchema.parse(await jsonBody(ctx.request));
        return ok(await departments.update(id, input, actor, ctx.request));
      }),

      // Deleting a department is structural and irreversible — super admin only.
      DELETE: api(async (ctx) => {
        const actor = await requireSuperAdmin(ctx.request);
        const id = uuid.parse(routeParam(ctx, "id"));
        await departments.remove(id, actor, ctx.request);
        return new Response(null, { status: 204 });
      }),
    },
  },
});
