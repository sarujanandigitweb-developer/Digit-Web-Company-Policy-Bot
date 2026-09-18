import { createFileRoute } from "@tanstack/react-router";
import { requireAuth } from "@/lib/auth/session.server";
import { api } from "@/lib/http/handler";
import { ok } from "@/lib/http/errors";
import { getLibraryTree } from "@/lib/services/google-library.server";
import type { LibraryNode } from "@/lib/services/google-sheet.server";

/**
 * /api/library/tree — the Document Library's hierarchy, read from the Google
 * Sheet (and, where a service account is configured, expanded with each
 * folder's real Drive contents).
 *
 * Deliberately separate from /api/admin/library/tree: that route reads
 * knowledge_folders/knowledge_documents, this one reads Google Sheets/Drive.
 * Neither calls the other; neither shares a table with the other.
 *
 * Gated behind requireAuth (any signed-in console role): the general chat is
 * public today, but these documents are internal operational SOPs, and this
 * app currently has no "normal user" account distinct from the admin console
 * — only super_admin/admin/team_leader exist. Opening this to everyone with
 * the chat's URL would mean opening it to anyone on the internet. If a
 * broader, non-console audience is wanted later, that needs a real user role
 * first, not a silent removal of this guard.
 */
export const Route = createFileRoute("/api/library/tree")({
  server: {
    handlers: {
      GET: api(async ({ request }) => {
        await requireAuth(request);
        const tree = await getLibraryTree();
        return ok({ tree: toClientNode(tree) });
      }),
    },
  },
});

/** Strips server-only fields (raw Drive URLs) before the tree leaves the server. */
function toClientNode(node: LibraryNode): unknown {
  return {
    id: node.id,
    name: node.name,
    owner: node.owner,
    kind: node.kind,
    isDocument: node.kind === "document",
    pending: node.pending ?? false,
    children: node.children.map(toClientNode),
  };
}
