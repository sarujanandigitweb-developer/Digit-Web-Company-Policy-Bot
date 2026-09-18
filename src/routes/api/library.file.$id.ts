import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireAuth } from "@/lib/auth/session.server";
import { routeParam } from "@/lib/http/handler";
import { toErrorResponse } from "@/lib/http/errors";
import { getLibraryTree, findNode } from "@/lib/services/google-library.server";
import { getDrivePdfBytes } from "@/lib/services/google-drive.server";

const nodeIdSchema = z.string().trim().min(1).max(300);

/**
 * /api/library/file/:id — streams a PDF's bytes through OUR server.
 *
 * The browser never talks to Drive and never sees a Drive URL or token: it
 * requests this route, and this route requests Drive server-side and pipes the
 * bytes back with our own content-type. That is what keeps the user inside
 * Ask the Digit for a PDF exactly as it does for a Word document — no redirect,
 * no new tab, no Drive login prompt.
 *
 * `:id` is validated the same way as /api/library/document/:id: resolved
 * against a freshly-read tree, not trusted as a bare Drive file id.
 */
export const Route = createFileRoute("/api/library/file/$id")({
  server: {
    handlers: {
      GET: async (ctx) => {
        try {
          await requireAuth(ctx.request);
          const id = nodeIdSchema.parse(routeParam(ctx, "id"));

          const tree = await getLibraryTree();
          const node = findNode(tree, id);
          if (!node || node.kind !== "document" || !node.link || node.link.kind === "folder") {
            return new Response("Not found", { status: 404 });
          }

          const bytes = await getDrivePdfBytes(node.link.id);
          // Response's BodyInit type doesn't include Node's Buffer; a plain
          // Uint8Array view over the same memory satisfies it with no copy.
          return new Response(new Uint8Array(bytes), {
            headers: {
              "content-type": "application/pdf",
              // inline, not attachment: the browser renders it, never downloads it.
              "content-disposition": `inline; filename="${node.name.replace(/"/g, "")}.pdf"`,
              "cache-control": "private, max-age=300",
            },
          });
        } catch (error) {
          return toErrorResponse(error);
        }
      },
    },
  },
});
