import { sql } from "@/lib/db/client.server";
import { NotFound } from "@/lib/http/errors";

/**
 * The Knowledge Library — the browsable hierarchy over existing resources.
 *
 * A "resource" is exactly one row in knowledge_documents. This service does not
 * parse, chunk or embed anything: every resource it returns was already put
 * through the existing upload pipeline, and its body is read from the
 * extracted_text column that pipeline persisted. Opening a resource costs one
 * indexed row read — the original file is never fetched or re-processed.
 *
 * Team leaders are scoped to their own department here exactly as they are on
 * every other knowledge surface (VR-05): they see the whole folder tree, but
 * only the resources their department owns.
 */

/** Presentation kind of a folder. The tree is walked by parentId alone. */
export type FolderKind = "root" | "platform" | "model" | "section" | "method";

export interface LibraryResource {
  id: string;
  title: string;
  description: string | null;
  /** Null for a resource that has not been filed into the hierarchy yet. */
  folderId: string | null;
  updatedAt: string;
  version: number;
  /** Present only when a source link was recorded at upload. */
  sourceUrl: string | null;
  /** False while the pipeline is still working, or if it produced nothing. */
  ready: boolean;
}

export interface LibraryFolder {
  id: string;
  parentId: string | null;
  name: string;
  ownerName: string | null;
  kind: FolderKind;
  sourceUrl: string | null;
  /** Resources filed directly in this folder. */
  resources: LibraryResource[];
  /** Resources in this folder and everything beneath it — lets the UI dim a
   *  branch that has nothing to open without walking it in the browser. */
  totalResources: number;
}

export interface LibraryTree {
  folders: LibraryFolder[];
  /** Uploaded but not yet filed into a folder. Surfaced rather than hidden — an
   *  invisible resource is worse than an unfiled one. */
  unfiled: LibraryResource[];
}

interface FolderRow {
  id: string;
  parent_id: string | null;
  name: string;
  owner_name: string | null;
  kind: FolderKind;
  drive_url: string | null;
}

interface ResourceRow {
  id: string;
  title: string;
  description: string | null;
  folder_id: string | null;
  updated_at: string;
  version: number;
  source_url: string | null;
  embedded_count: number;
}

function toResource(row: ResourceRow): LibraryResource {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    folderId: row.folder_id,
    updatedAt: row.updated_at,
    version: row.version,
    sourceUrl: row.source_url,
    ready: row.embedded_count > 0,
  };
}

/**
 * The whole tree in one round trip.
 *
 * Two flat queries, assembled in memory, rather than a query per level: the
 * hierarchy is tens of rows, and one shape the client can render beats N+1
 * requests that each pay a serverless cold path.
 */
export async function tree(departmentScope: string | null): Promise<LibraryTree> {
  const folderRows = (await sql`
    SELECT id, parent_id, name, owner_name, kind, drive_url
      FROM knowledge_folders
     WHERE status = 'active'
     ORDER BY sort_order, name
  `) as FolderRow[];

  // Only 'active' resources are listed, matching VR-03: if retrieval cannot
  // read a document, the library must not offer it as something to ask about.
  const resourceRows = (await sql`
    SELECT d.id, d.title, d.description, d.folder_id, d.updated_at, d.version, d.source_url,
           (SELECT count(*) FROM knowledge_chunks c
             WHERE c.document_id = d.id AND c.embedding IS NOT NULL)::int AS embedded_count
      FROM knowledge_documents d
     WHERE d.status = 'active'
       AND (${departmentScope}::uuid IS NULL OR d.department_id = ${departmentScope}::uuid)
     ORDER BY d.title
  `) as ResourceRow[];

  const folders: LibraryFolder[] = folderRows.map((f) => ({
    id: f.id,
    parentId: f.parent_id,
    name: f.name,
    ownerName: f.owner_name,
    kind: f.kind,
    sourceUrl: f.drive_url,
    resources: [],
    totalResources: 0,
  }));

  const byId = new Map(folders.map((f) => [f.id, f]));
  const unfiled: LibraryResource[] = [];

  for (const row of resourceRows) {
    const resource = toResource(row);
    const folder = resource.folderId ? byId.get(resource.folderId) : undefined;
    if (folder) folder.resources.push(resource);
    else unfiled.push(resource);
  }

  // Roll counts up to every ancestor. Walking parent pointers is O(depth) per
  // folder and needs no ordering assumption about the flat list.
  for (const folder of folders) {
    const own = folder.resources.length;
    if (own === 0) continue;
    let node: LibraryFolder | undefined = folder;
    const guard = new Set<string>();
    while (node && !guard.has(node.id)) {
      guard.add(node.id);
      node.totalResources += own;
      node = node.parentId ? byId.get(node.parentId) : undefined;
    }
  }

  return { folders, unfiled };
}

export interface ResourceDetail {
  id: string;
  title: string;
  description: string | null;
  /** Ancestor folder names, root first, for the breadcrumb. */
  path: string[];
  ownerName: string | null;
  updatedAt: string;
  version: number;
  sourceUrl: string | null;
  /** Page bodies in order. One entry for a source with no page concept. */
  pages: string[];
  /**
   * How to render `pages`. Word documents and Markdown files come out of
   * extraction as Markdown — real headings, lists, tables and images — so the
   * viewer renders them as a document. PDF and plain text have no such
   * structure and are rendered as laid-out text.
   */
  format: "markdown" | "text";
  ready: boolean;
}

/** The form feed the ingestion pipeline writes between pages. */
const PAGE_SEPARATOR = "\f";

/**
 * One resource, ready to display and to ask about.
 *
 * This is also the authorisation gate for resource-scoped chat: a resource that
 * does not resolve here (wrong id, not active, another department's) can never
 * become the active context, because the chat endpoint resolves through this
 * same function before it retrieves anything.
 */
export async function getResource(
  id: string,
  departmentScope: string | null,
): Promise<ResourceDetail> {
  const rows = (await sql`
    SELECT d.id, d.title, d.description, d.updated_at, d.version, d.source_url,
           -- The reading copy keeps inline images; extracted_text has had them
           -- stripped so the embedding step can use it. NULL means the two are
           -- the same. See migration 0010.
           COALESCE(d.display_text, d.extracted_text) AS body,
           d.file_type, d.folder_id, f.owner_name,
           (SELECT count(*) FROM knowledge_chunks c
             WHERE c.document_id = d.id AND c.embedding IS NOT NULL)::int AS embedded_count
      FROM knowledge_documents d
      LEFT JOIN knowledge_folders f ON f.id = d.folder_id
     WHERE d.id = ${id}::uuid
       AND d.status = 'active'
       AND (${departmentScope}::uuid IS NULL OR d.department_id = ${departmentScope}::uuid)
     LIMIT 1
  `) as Array<{
    id: string;
    title: string;
    description: string | null;
    updated_at: string;
    version: number;
    source_url: string | null;
    body: string | null;
    file_type: "pdf" | "docx" | "txt" | "md";
    folder_id: string | null;
    owner_name: string | null;
    embedded_count: number;
  }>;

  const row = rows[0];
  // Same message whether the id is unknown, inactive or out of scope: a caller
  // must not be able to probe for resources it may not open.
  if (!row) throw NotFound("This resource is not available");

  const path = row.folder_id ? await folderPath(row.folder_id) : [];
  const text = row.body ?? "";

  return {
    id: row.id,
    title: row.title,
    description: row.description,
    path,
    ownerName: row.owner_name,
    updatedAt: row.updated_at,
    version: row.version,
    sourceUrl: row.source_url,
    pages: text ? text.split(PAGE_SEPARATOR) : [],
    format: row.file_type === "docx" || row.file_type === "md" ? "markdown" : "text",
    ready: row.embedded_count > 0,
  };
}

/** Ancestor names for a folder, root first. */
export async function folderPath(folderId: string): Promise<string[]> {
  const rows = (await sql`
    WITH RECURSIVE up AS (
      SELECT id, parent_id, name, 0 AS depth
        FROM knowledge_folders WHERE id = ${folderId}::uuid
      UNION ALL
      SELECT f.id, f.parent_id, f.name, up.depth + 1
        FROM knowledge_folders f
        JOIN up ON f.id = up.parent_id
       -- Depth cap: a parent cycle would otherwise loop forever. The seed
       -- cannot create one, but a future editor could.
       WHERE up.depth < 12
    )
    SELECT name FROM up ORDER BY depth DESC
  `) as Array<{ name: string }>;
  return rows.map((r) => r.name);
}

/** Folder options for the upload form, as "Amazon / Model_01 / 01. Title". */
export async function folderOptions(
  departmentId: string,
): Promise<Array<{ id: string; label: string }>> {
  const rows = (await sql`
    WITH RECURSIVE down AS (
      SELECT id, parent_id, name, sort_order, name::text AS label, 0 AS depth,
             CASE WHEN kind = 'platform' THEN name ELSE NULL END AS platform
        FROM knowledge_folders
       WHERE parent_id IS NULL AND status = 'active'
      UNION ALL
      SELECT f.id, f.parent_id, f.name, f.sort_order,
             down.label || ' / ' || f.name, down.depth + 1,
             CASE WHEN f.kind = 'platform' THEN f.name ELSE down.platform END
        FROM knowledge_folders f
        JOIN down ON f.parent_id = down.id
       WHERE f.status = 'active' AND down.depth < 12
    )
    SELECT down.id, down.label FROM down
      JOIN departments d ON d.id = ${departmentId}::uuid
     -- The current library groups folders by platform (Amazon, eBay, Shopify).
     -- Match the complete department name without its optional " Team" suffix;
     -- never use partial matching or fall back to another platform.
     WHERE lower(btrim(down.platform)) = lower(regexp_replace(btrim(d.name), '[[:space:]]+team$', '', 'i'))
     ORDER BY down.label
  `) as Array<{ id: string; label: string }>;
  return rows;
}
