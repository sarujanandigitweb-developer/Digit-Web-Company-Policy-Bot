import { createFileRoute } from "@tanstack/react-router";
import { knowledgeScope, requireAdminArea } from "@/lib/auth/session.server";
import { api, jsonBody, routeParam } from "@/lib/http/handler";
import { ok } from "@/lib/http/errors";
import { uuid } from "@/lib/validators/admin";
import {
  setStatusSchema,
  updateDocumentSchema,
  reviewActionSchema,
} from "@/lib/validators/knowledge";
import * as knowledge from "@/lib/services/knowledge.service";
import * as review from "@/lib/knowledge/review.server";
import { z } from "zod";

/** /api/admin/knowledge/:id — details, lifecycle, delete. */
export const Route = createFileRoute("/api/admin/knowledge/$id")({
  server: {
    handlers: {
      GET: api(async (ctx) => {
        const user = await requireAdminArea(ctx.request);
        const id = uuid.parse(routeParam(ctx, "id"));
        const search = new URL(ctx.request.url).searchParams;
        if (search.get("review") === "1") {
          const page = z.coerce
            .number()
            .int()
            .min(1)
            .max(10000)
            .parse(search.get("page") ?? 1);
          return ok(await review.getReview(id, user, page));
        }
        return ok(await knowledge.getById(id, knowledgeScope(user)));
      }),

      // One PATCH serves two shapes: a lifecycle change ({status}) from the
      // quick actions, or a metadata edit ({title, description, departmentId})
      // from the Edit dialog — routed by which fields the body carries.
      PATCH: api(async (ctx) => {
        const actor = await requireAdminArea(ctx.request);
        const id = uuid.parse(routeParam(ctx, "id"));
        const body = (await jsonBody(ctx.request)) as Record<string, unknown>;

        if ("reviewAction" in body) {
          const input = reviewActionSchema.parse(body);
          switch (input.reviewAction) {
            case "start":
              return ok(await review.startReview(id, actor, ctx.request));
            case "compare":
              await review.compareNext(id, actor);
              break;
            case "decide":
              await review.decide(id, input, actor, ctx.request);
              break;
            case "publish":
              await review.publish(id, input.run, actor, ctx.request);
              break;
          }
          return ok(await review.getReview(id, actor));
        }
        if ("status" in body) {
          const { status } = setStatusSchema.parse(body);
          return ok(await knowledge.setStatus(id, status, actor, ctx.request));
        }
        const input = updateDocumentSchema.parse(body);
        return ok(await knowledge.updateMetadata(id, input, actor, ctx.request));
      }),

      // Deleting destroys the chunks and the citations pointing at them. A team
      // leader may delete only within their own department (enforced in the
      // service); admins and super admins may delete any document.
      DELETE: api(async (ctx) => {
        const actor = await requireAdminArea(ctx.request);
        await knowledge.remove(uuid.parse(routeParam(ctx, "id")), actor, ctx.request);
        return new Response(null, { status: 204 });
      }),
    },
  },
});
