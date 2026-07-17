import { createFileRoute } from "@tanstack/react-router";
import { requireAdmin, requireSuperAdmin } from "@/lib/auth/session.server";
import { api, jsonBody, routeParam } from "@/lib/http/handler";
import { ok } from "@/lib/http/errors";
import { updateUserSchema, uuid } from "@/lib/validators/admin";
import * as users from "@/lib/services/users.service";

/** /api/admin/users/:id — single-resource routes. */
export const Route = createFileRoute("/api/admin/users/$id")({
  server: {
    handlers: {
      GET: api(async (ctx) => {
        await requireAdmin(ctx.request);
        return ok(await users.getById(uuid.parse(routeParam(ctx, "id"))));
      }),

      // Admin-level guard; the service narrows it further — admins may only touch
      // staff, and only a super admin may change a role.
      PATCH: api(async (ctx) => {
        const actor = await requireAdmin(ctx.request);
        const id = uuid.parse(routeParam(ctx, "id"));
        const input = updateUserSchema.parse(await jsonBody(ctx.request));
        return ok(await users.update(id, input, actor, ctx.request));
      }),

      DELETE: api(async (ctx) => {
        const actor = await requireSuperAdmin(ctx.request);
        await users.remove(uuid.parse(routeParam(ctx, "id")), actor, ctx.request);
        return new Response(null, { status: 204 });
      }),
    },
  },
});
