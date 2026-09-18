import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireAuth } from "@/lib/auth/session.server";
import { api, routeParam } from "@/lib/http/handler";
import { NotFound, ok } from "@/lib/http/errors";
import { resolveDocument } from "@/lib/services/google-library.server";
import type { LibraryNode } from "@/lib/services/google-sheet.server";

const nodeIdSchema = z.string().trim().min(1).max(300);

/**
 * /api/library/document/:id — one document's content, ready to read.
 *
 * `:id` is our own tree node id (see google-sheet.server.ts — either a Drive
 * id or a stable ancestor-path key), NOT a raw, unverified Drive file id
 * accepted at face value: resolveDocument looks it up inside a freshly-read
 * tree, so a caller can only ever open a document this library currently
 * lists, never an arbitrary string.
 *
 * A PDF's bytes are never inlined into this JSON response — the frontend
 * fetches them separately from /api/library/file/:id and renders them in an
 * embedded viewer. `format: "pdf"` is the signal to do that instead of
 * rendering `text`.
 */
export const Route = createFileRoute("/api/library/document/$id")({
  server: {
    handlers: {
      GET: api(async (ctx) => {
        await requireAuth(ctx.request);
        const id = nodeIdSchema.parse(routeParam(ctx, "id"));

        const resolved = await resolveDocument(id);
        if (!resolved) throw NotFound("This document is not available");
        const { node, content, tree } = resolved;

        const isPdf = content.mimeType === "application/pdf";

        return ok({
          id: node.id,
          name: content.name,
          path: ancestorNames(tree, node.id),
          owner: node.owner,
          format: isPdf ? "pdf" : "markdown",
          // The reading copy (images kept), never the AI-safe stripped copy —
          // that one only ever reaches library-ai.server.ts, on the server.
          text: isPdf ? null : content.displayText,
          ready: content.ready,
        });
      }),
    },
  },
});

/** Ancestor names from root to (excluding) the node itself, for the breadcrumb. */
function ancestorNames(root: LibraryNode, targetId: string): string[] {
  const path: string[] = [];
  function walk(node: LibraryNode, trail: string[]): boolean {
    if (node.id === targetId) {
      path.push(...trail);
      return true;
    }
    const nextTrail = node.kind === "root" ? trail : [...trail, node.name];
    return node.children.some((child) => walk(child, nextTrail));
  }
  walk(root, []);
  return path;
}
