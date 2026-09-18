import { fetchLibraryTree, type LibraryNode } from "./google-sheet.server";
import { listFolder, getDriveDocument, type DriveDocument } from "./google-drive.server";

/**
 * Orchestrates the two halves of the user-facing Document Library:
 *   google-sheet.server.ts   — the hierarchy and its Drive links
 *   google-drive.server.ts   — turning a link into content
 *
 * This is the ONLY module either the tree route or the document route calls.
 * Neither knows about xlsx parsing or Drive's API directly, and neither
 * imports anything from the Admin Knowledge system (knowledge_documents,
 * knowledge_chunks, knowledge_folders, retrieval.service.ts) — this feature's
 * isolation boundary is that no file in this trio ever does.
 */

/** Safety caps on folder expansion — real only once a service account exists;
 *  a no-op cost today, since listFolder returns null without one. */
const MAX_EXPANSION_DEPTH = 6;
const MAX_FOLDERS_PER_TREE = 200;

/**
 * Walks the sheet-derived tree and, for every node that is itself a Drive
 * folder link (a Method/Section/Model naming a folder rather than a document),
 * lists that folder's real contents and attaches them as document children.
 *
 * Breadth-first and batched per level (Promise.all), not one-call-per-node
 * sequentially, so a deployment with many folders still resolves in a handful
 * of round trips rather than dozens in series.
 *
 * A folder this deployment cannot list (no service account configured) is
 * marked `pending: true` rather than silently left empty — an unlisted folder
 * and a genuinely empty one must never look the same to the user.
 */
async function expandFolders(root: LibraryNode): Promise<LibraryNode> {
  let calls = 0;
  let frontier: LibraryNode[] = [root];

  for (let depth = 0; depth < MAX_EXPANSION_DEPTH && frontier.length > 0; depth++) {
    const toExpand = frontier.filter(
      (n) => n.link?.kind === "folder" && calls < MAX_FOLDERS_PER_TREE,
    );
    calls += toExpand.length;

    await Promise.all(
      toExpand.map(async (node) => {
        try {
          const children = await listFolder(node.link!.id);
          if (children === null) {
            node.pending = true;
            return;
          }
          for (const child of children) {
            // The sheet's own hierarchy cells (e.g. "Model_01", "Method_01")
            // are folder LINKS to these exact same sub-folders — so the sheet
            // parser has already created a node with this name at this level.
            // Reuse it rather than pushing a second, name-duplicate node:
            // without this, every level below duplicates, because both the
            // sheet's copy and the newly-listed copy carry the same real
            // Drive folder id and each independently expands the same
            // contents beneath it.
            const existing = node.children.find(
              (c) =>
                c.name === child.name &&
                (child.isFolder ? c.kind !== "document" : c.kind === "document"),
            );

            if (child.isFolder) {
              if (existing) {
                if (!existing.link) existing.link = { kind: "folder", id: child.id, url: "" };
                continue;
              }
              node.children.push({
                id: `d:${child.id}`,
                name: child.name,
                owner: null,
                kind: node.kind, // an unnamed sub-level inherits its parent's kind
                link: { kind: "folder", id: child.id, url: "" },
                children: [],
              });
            } else {
              if (existing) continue; // already represented (e.g. by a sheet link)
              node.children.push({
                id: `d:${child.id}`,
                name: child.name,
                owner: null,
                kind: "document",
                link: { kind: "file", id: child.id, url: "" },
                children: [],
              });
            }
          }
        } catch (error) {
          // A single folder failing (deleted, permission revoked) must not
          // take down the whole tree — it just stays empty for this request.
          console.error(`[google-library] could not list folder ${node.link!.id}:`, error);
        }
      }),
    );

    // Next level: children just discovered, plus anything already in the
    // sheet-derived tree that hasn't been visited yet.
    frontier = frontier.flatMap((n) => n.children);
  }

  return root;
}

/**
 * Same pattern as transcript.server.ts's module-level cache: cheap, and only
 * ever wrong in the direction of re-fetching a little early on a cold
 * instance — never in the direction of serving something stale past its TTL.
 * Needed because folder expansion, once a service account exists, is a real
 * Drive API call per folder; without this, opening any one document would
 * re-list every folder in the tree first just to validate its id.
 */
let treeCache: { tree: LibraryNode; at: number } | null = null;
let treeRequest: Promise<LibraryNode> | null = null;
const TREE_CACHE_TTL_MS = 2 * 60 * 1000;

/** The full Document Library tree: sheet hierarchy + expanded folder contents. */
export async function getLibraryTree(): Promise<LibraryNode> {
  if (treeCache && Date.now() - treeCache.at < TREE_CACHE_TTL_MS) return treeCache.tree;
  if (treeRequest) return treeRequest;
  treeRequest = (async () => {
    const tree = await expandFolders(structuredClone(await fetchLibraryTree()));
    treeCache = { tree, at: Date.now() };
    return tree;
  })();
  try {
    return await treeRequest;
  } finally {
    treeRequest = null;
  }
}

/** Finds one node by id within an already-built tree. */
export function findNode(root: LibraryNode, id: string): LibraryNode | null {
  if (root.id === id) return root;
  for (const child of root.children) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}

/**
 * Resolves and fetches a document node's content by id.
 *
 * The id is looked up inside a freshly-read tree rather than trusted as a
 * standalone Drive file id: the tree read is what proves the id corresponds to
 * an actual document this library currently lists, not an arbitrary string the
 * caller made up. The tree read itself is cheap (see google-sheet.server.ts —
 * no Drive credentials are spent reading the sheet); the expensive Drive fetch
 * happens only for the one node asked for, and only on a cache miss.
 */
export async function resolveDocument(
  nodeId: string,
): Promise<{ node: LibraryNode; content: DriveDocument; tree: LibraryNode } | null> {
  const tree = await getLibraryTree();
  const node = findNode(tree, nodeId);
  if (!node || node.kind !== "document" || !node.link || node.link.kind === "folder") {
    return null;
  }
  const content = await getDriveDocument(node.link, node.name);
  return { node, content, tree };
}
