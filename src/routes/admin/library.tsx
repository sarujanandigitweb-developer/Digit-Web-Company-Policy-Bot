import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown, { defaultUrlTransform, type Components } from "react-markdown";
import {
  ArrowUpRight,
  BookOpen,
  ChevronRight,
  CornerDownLeft,
  FileText,
  Folder,
  Layers,
  Library,
  Search,
  Sparkles,
  Store,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api/client";
import { getToken } from "@/lib/auth/client";
import { useDebounced } from "@/hooks/use-debounced";
import { useMe } from "@/hooks/use-me";
import { can } from "@/lib/auth/permissions";
import { PageHeader } from "@/components/admin/primitives";
import { EmptyState, ErrorState, LoadingBlock } from "@/components/admin/states";
import {
  BRAND,
  CARD,
  FOCUS_RING,
  SURFACE_SUNK,
  TEXT_EYEBROW,
  TEXT_MUTED,
  TEXT_SECTION,
  TEXT_SUBTLE,
  TILE_GRADIENT,
  TONE,
} from "@/components/admin/theme";

export const Route = createFileRoute("/admin/library")({
  component: KnowledgeLibraryPage,
});

/* ------------------------------------------------------------------ types */

type FolderKind = "root" | "platform" | "model" | "section" | "method";

interface Resource {
  id: string;
  title: string;
  description: string | null;
  folderId: string | null;
  updatedAt: string;
  version: number;
  sourceUrl: string | null;
  ready: boolean;
}

interface LibraryFolder {
  id: string;
  parentId: string | null;
  name: string;
  ownerName: string | null;
  kind: FolderKind;
  sourceUrl: string | null;
  resources: Resource[];
  totalResources: number;
}

interface LibraryTree {
  folders: LibraryFolder[];
  unfiled: Resource[];
}

interface ResourceDetail {
  id: string;
  title: string;
  description: string | null;
  path: string[];
  ownerName: string | null;
  updatedAt: string;
  version: number;
  sourceUrl: string | null;
  pages: string[];
  format: "markdown" | "text";
  ready: boolean;
}

interface FollowupData {
  suggestions: string[];
  chips: string[];
  scope: "resource";
  resourceTitle: string;
  lowConfidence: boolean;
}

/**
 * What the right-hand pane is showing.
 *
 * Folders are selectable, not just expandable. A folder with nothing in it is
 * common while the library is still being filled, and a click that silently does
 * nothing reads as a broken page — so every row leads somewhere, and an empty
 * folder says so itself.
 */
type Selection = { type: "folder" | "resource"; id: string } | null;

/* ------------------------------------------------------------------ page */

/**
 * The Knowledge Library.
 *
 * Browse the hierarchy on the left, read a resource on the right, and ask
 * questions about that one resource beside it. Selecting a resource is what
 * scopes the assistant: every question asked in this workspace is answered from
 * the open resource alone.
 */
function KnowledgeLibraryPage() {
  const [selected, setSelected] = useState<Selection>(null);
  const [search, setSearch] = useState("");
  const query = useDebounced(search);

  const tree = useQuery({
    queryKey: ["library-tree"],
    queryFn: () => api.get<LibraryTree>("/api/admin/library/tree"),
  });

  const resourceId = selected?.type === "resource" ? selected.id : null;
  const resource = useQuery({
    queryKey: ["library-resource", resourceId],
    queryFn: () => api.get<ResourceDetail>(`/api/admin/library/resources/${resourceId}`),
    enabled: !!resourceId,
  });

  // Indexed once here rather than inside the browser, because the folder
  // overview on the right needs the same parent/child lookups.
  const folders = useMemo(() => tree.data?.folders ?? [], [tree.data]);
  const byId = useMemo(() => new Map(folders.map((f) => [f.id, f])), [folders]);
  const childrenOf = useMemo(() => {
    const map = new Map<string | null, LibraryFolder[]>();
    for (const folder of folders) {
      const list = map.get(folder.parentId) ?? [];
      list.push(folder);
      map.set(folder.parentId, list);
    }
    return map;
  }, [folders]);

  const selectedFolder = selected?.type === "folder" ? byId.get(selected.id) : undefined;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Knowledge Library"
        description="Open a resource to read it, and ask the assistant about that resource on its own."
      />

      <div className="grid gap-6 lg:grid-cols-[336px_minmax(0,1fr)] lg:items-start">
        <div className="lg:sticky lg:top-6">
          {tree.isLoading ? (
            <div className={CARD}>
              <LoadingBlock label="Loading the library…" />
            </div>
          ) : tree.error ? (
            <div className={CARD}>
              <ErrorState error={tree.error} onRetry={() => void tree.refetch()} />
            </div>
          ) : (
            <LibraryBrowser
              tree={tree.data!}
              childrenOf={childrenOf}
              search={search}
              query={query}
              onSearch={setSearch}
              selected={selected}
              onSelect={setSelected}
            />
          )}
        </div>

        {selectedFolder ? (
          <FolderOverview
            folder={selectedFolder}
            byId={byId}
            childrenOf={childrenOf}
            onSelect={setSelected}
          />
        ) : !resourceId ? (
          <div className={CARD}>
            <EmptyState
              icon={Library}
              title="Choose a resource to begin"
              description="Pick a platform, then a model, then the resource you need. Once it is open you can read it here and ask the assistant about it."
            />
          </div>
        ) : resource.isLoading ? (
          <div className={CARD}>
            <LoadingBlock label="Opening the resource…" />
          </div>
        ) : resource.error ? (
          <div className={CARD}>
            <ErrorState error={resource.error} onRetry={() => void resource.refetch()} />
          </div>
        ) : (
          <ResourceWorkspace resource={resource.data!} />
        )}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- browser */

const KIND_ICON: Record<FolderKind, typeof Folder> = {
  root: Library,
  platform: Store,
  model: Layers,
  section: Folder,
  method: BookOpen,
};

/**
 * The hierarchy panel.
 *
 * Search matches folder names and resource titles, and a branch stays visible
 * when anything beneath it matches — otherwise searching for a resource would
 * hide the path you need to click to reach it.
 */
function LibraryBrowser({
  tree,
  childrenOf,
  search,
  query,
  onSearch,
  selected,
  onSelect,
}: {
  tree: LibraryTree;
  childrenOf: Map<string | null, LibraryFolder[]>;
  search: string;
  query: string;
  onSearch: (v: string) => void;
  selected: Selection;
  onSelect: (s: Selection) => void;
}) {
  const needle = query.trim().toLowerCase();

  /**
   * Folder ids to show while searching. A folder qualifies on its own name, on
   * one of its resources, or on any descendant that qualifies — computed once
   * per search rather than re-walked at every node during render.
   */
  const matching = useMemo(() => {
    if (!needle) return null;
    const hits = new Set<string>();
    const walk = (folder: LibraryFolder): boolean => {
      const children = childrenOf.get(folder.id) ?? [];
      // Every child is walked before the short-circuit, so a deep match still
      // marks its own branch.
      const childHit = children.map(walk).some(Boolean);
      const selfHit =
        folder.name.toLowerCase().includes(needle) ||
        (folder.ownerName ?? "").toLowerCase().includes(needle) ||
        folder.resources.some((r) => r.title.toLowerCase().includes(needle));
      if (selfHit || childHit) hits.add(folder.id);
      return selfHit || childHit;
    };
    for (const root of childrenOf.get(null) ?? []) walk(root);
    return hits;
  }, [needle, childrenOf]);

  // Expanded by default: the roots and the platforms, so the library opens on
  // something meaningful rather than a single collapsed row.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const initialised = useRef(false);
  useEffect(() => {
    if (initialised.current || tree.folders.length === 0) return;
    initialised.current = true;
    setExpanded(
      new Set(
        tree.folders.filter((f) => f.kind === "root" || f.kind === "platform").map((f) => f.id),
      ),
    );
  }, [tree.folders]);

  const toggle = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const roots = childrenOf.get(null) ?? [];
  const nothingMatched = matching !== null && matching.size === 0 && tree.unfiled.length === 0;

  return (
    <div className={`${CARD} flex max-h-[calc(100vh-7rem)] flex-col overflow-hidden`}>
      <div className="border-b border-slate-100 p-4 dark:border-white/[0.06]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search the library…"
            className="pl-9 pr-9"
            aria-label="Search the library"
          />
          {search && (
            <button
              type="button"
              onClick={() => onSearch("")}
              className={`absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 ${FOCUS_RING}`}
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {nothingMatched ? (
          <p className={`px-3 py-8 text-center ${TEXT_MUTED}`}>Nothing matches “{search}”.</p>
        ) : (
          roots.map((folder) => (
            <TreeNode
              key={folder.id}
              folder={folder}
              depth={0}
              childrenOf={childrenOf}
              expanded={expanded}
              onToggle={toggle}
              matching={matching}
              needle={needle}
              selected={selected}
              onSelect={onSelect}
            />
          ))
        )}

        {tree.unfiled.length > 0 && (
          <div className="mt-2 border-t border-slate-100 pt-2 dark:border-white/[0.06]">
            <p className={`px-3 py-1.5 ${TEXT_EYEBROW}`}>Not filed yet</p>
            {tree.unfiled
              .filter((r) => !needle || r.title.toLowerCase().includes(needle))
              .map((r) => (
                <ResourceRow
                  key={r.id}
                  resource={r}
                  depth={1}
                  selected={selected?.type === "resource" && selected.id === r.id}
                  onSelect={onSelect}
                />
              ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TreeNode({
  folder,
  depth,
  childrenOf,
  expanded,
  onToggle,
  matching,
  needle,
  selected,
  onSelect,
}: {
  folder: LibraryFolder;
  depth: number;
  childrenOf: Map<string | null, LibraryFolder[]>;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  matching: Set<string> | null;
  needle: string;
  selected: Selection;
  onSelect: (s: Selection) => void;
}) {
  if (matching && !matching.has(folder.id)) return null;

  const children = childrenOf.get(folder.id) ?? [];
  // While searching the tree opens itself, so a match is never hidden behind a
  // collapsed parent the user would have to guess at.
  const isOpen = matching !== null || expanded.has(folder.id);
  const hasChildren = children.length > 0 || folder.resources.length > 0;
  const Icon = KIND_ICON[folder.kind];
  const empty = folder.totalResources === 0;
  const isSelected = selected?.type === "folder" && selected.id === folder.id;
  const visibleResources = needle
    ? folder.resources.filter((r) => r.title.toLowerCase().includes(needle))
    : folder.resources;

  return (
    <div>
      <button
        type="button"
        onClick={() => {
          // Select first, expand second. Selecting always does something visible
          // — including on a leaf folder with nothing in it, which is what a
          // half-filled library is mostly made of.
          onSelect({ type: "folder", id: folder.id });
          if (hasChildren) onToggle(folder.id);
        }}
        style={{ paddingLeft: 8 + depth * 14 }}
        aria-current={isSelected ? "true" : undefined}
        className={`group flex w-full items-center gap-2 rounded-lg py-1.5 pr-2 text-left transition ${FOCUS_RING} ${
          isSelected ? TONE.brand.bg : "hover:bg-slate-50 dark:hover:bg-white/[0.04]"
        }`}
        aria-expanded={hasChildren ? isOpen : undefined}
      >
        <ChevronRight
          className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform ${
            isOpen ? "rotate-90" : ""
          } ${hasChildren ? "" : "invisible"}`}
        />
        {folder.kind === "platform" ? (
          <span
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-white"
            style={{ background: TILE_GRADIENT }}
          >
            <Icon className="h-3.5 w-3.5" />
          </span>
        ) : (
          <Icon
            className={`h-4 w-4 shrink-0 ${empty ? "text-slate-300 dark:text-slate-600" : "text-slate-400"}`}
          />
        )}
        <span className="min-w-0 flex-1">
          <span
            className={`block truncate text-[13px] ${
              folder.kind === "platform" || folder.kind === "root"
                ? "font-semibold text-slate-900 dark:text-white"
                : empty
                  ? "text-slate-400 dark:text-slate-500"
                  : "text-slate-700 dark:text-slate-200"
            }`}
          >
            {folder.name}
          </span>
          {folder.ownerName && (
            <span className={`block truncate ${TEXT_SUBTLE}`}>{folder.ownerName}</span>
          )}
        </span>
        {folder.totalResources > 0 && (
          <span
            className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${TONE.slate.bg} ${TONE.slate.fg}`}
          >
            {folder.totalResources}
          </span>
        )}
      </button>

      {isOpen && (
        <div>
          {visibleResources.map((r) => (
            <ResourceRow
              key={r.id}
              resource={r}
              depth={depth + 1}
              selected={selected?.type === "resource" && selected.id === r.id}
              onSelect={onSelect}
            />
          ))}
          {children.map((child) => (
            <TreeNode
              key={child.id}
              folder={child}
              depth={depth + 1}
              childrenOf={childrenOf}
              expanded={expanded}
              onToggle={onToggle}
              matching={matching}
              needle={needle}
              selected={selected}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ResourceRow({
  resource,
  depth,
  selected,
  onSelect,
}: {
  resource: Resource;
  depth: number;
  selected: boolean;
  onSelect: (s: Selection) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect({ type: "resource", id: resource.id })}
      style={{ paddingLeft: 8 + depth * 14 + 20 }}
      aria-current={selected ? "true" : undefined}
      className={`flex w-full items-center gap-2 rounded-lg py-1.5 pr-2 text-left transition ${FOCUS_RING} ${
        selected
          ? `${TONE.brand.bg} font-medium text-[#15243D] dark:text-white`
          : "hover:bg-slate-50 dark:hover:bg-white/[0.04]"
      }`}
    >
      <FileText
        className={`h-4 w-4 shrink-0 ${
          selected ? "text-[#15243D] dark:text-white" : "text-slate-400"
        }`}
      />
      <span className="min-w-0 flex-1 truncate text-[13px]">{resource.title}</span>
      {!resource.ready && (
        <span className={`shrink-0 text-[10px] font-medium ${TONE.amber.fg}`}>preparing</span>
      )}
    </button>
  );
}

/* -------------------------------------------------------- folder overview */

const KIND_LABEL: Record<FolderKind, string> = {
  root: "Library",
  platform: "Platform",
  model: "Model",
  section: "Section",
  method: "Method",
};

/** Ancestor names, root first. Walked from the tree already in memory. */
function pathOf(folder: LibraryFolder, byId: Map<string, LibraryFolder>): string[] {
  const names: string[] = [];
  let node: LibraryFolder | undefined = folder;
  const guard = new Set<string>();
  while (node && !guard.has(node.id)) {
    guard.add(node.id);
    names.unshift(node.name);
    node = node.parentId ? byId.get(node.parentId) : undefined;
  }
  return names;
}

/**
 * What is inside a folder.
 *
 * Shown whenever a folder is clicked, so no row in the tree is ever a dead
 * click. When a folder holds nothing it says so plainly and offers the two
 * things that actually help — add a resource, or open the original location.
 */
function FolderOverview({
  folder,
  byId,
  childrenOf,
  onSelect,
}: {
  folder: LibraryFolder;
  byId: Map<string, LibraryFolder>;
  childrenOf: Map<string | null, LibraryFolder[]>;
  onSelect: (s: Selection) => void;
}) {
  const me = useMe();
  // The same permission the server enforces on upload. Someone who cannot add a
  // resource is not shown a button that would only fail — the empty state tells
  // them the location is empty and stops there.
  const canAddResource = me.data ? can(me.data.role, "knowledge.manage") : false;
  const path = pathOf(folder, byId);
  const children = childrenOf.get(folder.id) ?? [];
  const resources = folder.resources;
  const isEmpty = children.length === 0 && resources.length === 0;

  return (
    <div className="space-y-6">
      <div className={`${CARD} p-5`}>
        <nav aria-label="Location" className="flex flex-wrap items-center gap-1.5">
          {path.slice(0, -1).map((name, i) => (
            <span key={`${name}-${i}`} className="flex items-center gap-1.5">
              {i > 0 && <ChevronRight className="h-3 w-3 text-slate-300 dark:text-slate-600" />}
              <span className={TEXT_SUBTLE}>{name}</span>
            </span>
          ))}
        </nav>

        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold tracking-[-0.01em] text-slate-900 dark:text-white">
              {folder.name}
            </h2>
            <p className={`mt-1 ${TEXT_MUTED}`}>
              {KIND_LABEL[folder.kind]}
              {folder.ownerName ? ` · ${folder.ownerName}` : ""} ·{" "}
              {folder.totalResources === 1 ? "1 resource" : `${folder.totalResources} resources`}
            </p>
          </div>

          {folder.sourceUrl && (
            <Button asChild variant="outline" size="sm">
              <a href={folder.sourceUrl} target="_blank" rel="noreferrer noopener">
                Open original
                <ArrowUpRight className="ml-1.5 h-3.5 w-3.5" />
              </a>
            </Button>
          )}
        </div>
      </div>

      {isEmpty ? (
        <div className={CARD}>
          <EmptyState
            icon={Folder}
            title="No resources have been added to this location yet"
            description={
              canAddResource
                ? "Add a resource from the Knowledge page and choose this location, and it will appear here."
                : "Nothing has been published here so far."
            }
            action={
              canAddResource ? (
                <Button asChild size="sm">
                  <Link to="/admin/knowledge">Add a resource</Link>
                </Button>
              ) : undefined
            }
          />
        </div>
      ) : (
        <div className={`${CARD} p-5`}>
          {resources.length > 0 && (
            <>
              <h3 className={TEXT_SECTION}>Resources</h3>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {resources.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => onSelect({ type: "resource", id: r.id })}
                    className={`flex items-start gap-2.5 rounded-xl border border-slate-200 p-3 text-left transition hover:border-slate-300 hover:bg-slate-50 dark:border-white/10 dark:hover:bg-white/[0.04] ${FOCUS_RING}`}
                  >
                    <FileText className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-medium text-slate-800 dark:text-slate-100">
                        {r.title}
                      </span>
                      <span className={`block ${TEXT_SUBTLE}`}>
                        {r.ready ? "Ready to open" : "Still preparing"}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}

          {children.length > 0 && (
            <>
              <h3 className={`${TEXT_SECTION} ${resources.length > 0 ? "mt-6" : ""}`}>Inside</h3>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {children.map((c) => {
                  const Icon = KIND_ICON[c.kind];
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => onSelect({ type: "folder", id: c.id })}
                      className={`flex items-start gap-2.5 rounded-xl border border-slate-200 p-3 text-left transition hover:border-slate-300 hover:bg-slate-50 dark:border-white/10 dark:hover:bg-white/[0.04] ${FOCUS_RING}`}
                    >
                      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] font-medium text-slate-800 dark:text-slate-100">
                          {c.name}
                        </span>
                        <span className={`block ${TEXT_SUBTLE}`}>
                          {c.ownerName ? `${c.ownerName} · ` : ""}
                          {c.totalResources === 1 ? "1 resource" : `${c.totalResources} resources`}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------- workspace */

/** The open resource: what it is, what it says, and a place to ask about it. */
function ResourceWorkspace({ resource }: { resource: ResourceDetail }) {
  return (
    <div className="space-y-6">
      <div className={`${CARD} p-5`}>
        <nav aria-label="Location" className="flex flex-wrap items-center gap-1.5">
          {resource.path.map((name, i) => (
            <span key={`${name}-${i}`} className="flex items-center gap-1.5">
              {i > 0 && <ChevronRight className="h-3 w-3 text-slate-300 dark:text-slate-600" />}
              <span className={TEXT_SUBTLE}>{name}</span>
            </span>
          ))}
        </nav>

        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold tracking-[-0.01em] text-slate-900 dark:text-white">
              {resource.title}
            </h2>
            <p className={`mt-1 ${TEXT_MUTED}`}>
              {resource.ownerName ? `${resource.ownerName} · ` : ""}
              Version {resource.version} · Updated{" "}
              {new Date(resource.updatedAt).toLocaleDateString()}
            </p>
            {resource.description && (
              <p className={`mt-2 max-w-2xl ${TEXT_MUTED}`}>{resource.description}</p>
            )}
          </div>

          {resource.sourceUrl && (
            <Button asChild variant="outline" size="sm">
              <a href={resource.sourceUrl} target="_blank" rel="noreferrer noopener">
                Open original
                <ArrowUpRight className="ml-1.5 h-3.5 w-3.5" />
              </a>
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] xl:items-start">
        <ResourceViewer resource={resource} />
        <AskPanel resource={resource} />
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- viewer */

/** A line that reads as a heading: "## Overview", or "6.1 General Guidelines". */
const MARKDOWN_HEADING = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/;
const NUMBERED_HEADING = /^\s*(\d{1,2}(?:\.\d{1,2})*)\s+([A-Z][^.\n]{2,80})\s*$/;

function headingOf(line: string): string | null {
  const markdown = MARKDOWN_HEADING.exec(line);
  if (markdown) return markdown[1].replace(/\*\*/g, "").trim();
  const numbered = NUMBERED_HEADING.exec(line);
  if (numbered) return `${numbered[1]} ${numbered[2].trim()}`;
  return null;
}

/**
 * Which URLs the document viewer will render.
 *
 * Word documents carry their screenshots inline as base64, and react-markdown
 * blocks every `data:` URL by default. Raster image types are allowed back in
 * so the screenshots show; `data:text/html` and SVG are deliberately NOT, since
 * both can carry script and the document body is not ours.
 */
const SAFE_IMAGE_DATA = /^data:image\/(png|jpe?g|gif|webp|bmp);base64,/i;

function documentUrlTransform(url: string): string {
  if (SAFE_IMAGE_DATA.test(url)) return url;
  return defaultUrlTransform(url);
}

/** Document-grade renderers, so the body reads as a page rather than a blob. */
const DOC_COMPONENTS: Components = {
  h1: ({ children }) => (
    <h2 className="mt-7 border-b border-slate-200 pb-1.5 text-[17px] font-semibold tracking-[-0.01em] text-slate-900 first:mt-0 dark:border-white/10 dark:text-white">
      {children}
    </h2>
  ),
  h2: ({ children }) => (
    <h3 className="mt-6 text-[15px] font-semibold text-slate-900 dark:text-white">{children}</h3>
  ),
  h3: ({ children }) => (
    <h4 className="mt-5 text-[13.5px] font-semibold text-slate-800 dark:text-slate-100">
      {children}
    </h4>
  ),
  p: ({ children }) => <p className="mt-3 leading-[1.75]">{children}</p>,
  ul: ({ children }) => <ul className="mt-3 list-disc space-y-1 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="mt-3 list-decimal space-y-1 pl-5">{children}</ol>,
  li: ({ children }) => <li className="leading-[1.7]">{children}</li>,
  strong: ({ children }) => (
    <strong className="font-semibold text-slate-900 dark:text-white">{children}</strong>
  ),
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="text-[#2b6cf3] underline underline-offset-2 hover:opacity-80"
    >
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote className="mt-3 border-l-2 border-slate-300 pl-4 italic text-slate-600 dark:border-white/20 dark:text-slate-400">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-6 border-slate-200 dark:border-white/10" />,
  // No table renderer here on purpose. mammoth's markdown writer handles only
  // p/br/ul/ol/li/strong/em/a/img/h1-h6 — a Word table is flattened into loose
  // paragraphs during extraction, so there is no table left to style. Styling
  // one would only imply support the stored content cannot deliver. See the
  // limitations note: fixing it means extracting DOCX as HTML, not Markdown.
  code: ({ children }) => (
    <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[12px] dark:bg-white/10">
      {children}
    </code>
  ),
  // Screenshots are the point of a method guide, so they get real presence.
  img: ({ src, alt }) => (
    <img
      src={typeof src === "string" ? src : undefined}
      alt={alt ?? ""}
      loading="lazy"
      className="my-4 max-w-full rounded-lg border border-slate-200 shadow-sm dark:border-white/10"
    />
  ),
};

/**
 * The resource body, rendered inside the dashboard.
 *
 * The content is the copy captured when the resource was added, so opening it
 * is a single indexed row read: the original file is never fetched, never
 * re-parsed, and nothing is re-processed when a question is asked.
 *
 * Word documents arrive as Markdown (extraction runs through
 * mammoth.convertToMarkdown), which is why headings, lists, tables and inline
 * screenshots survive and can be laid out as a document. PDF and plain text
 * have no such structure, so they fall back to line-preserving text.
 */
function ResourceViewer({ resource }: { resource: ResourceDetail }) {
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [resource.id]);

  const pages = resource.pages;
  const body = pages[page] ?? "";
  const lines = useMemo(() => body.split("\n"), [body]);

  return (
    <section className={`${CARD} flex max-h-[calc(100vh-14rem)] flex-col overflow-hidden`}>
      <header className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-3.5 dark:border-white/[0.06]">
        <h3 className={TEXT_SECTION}>Document</h3>
        {pages.length > 1 && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              Previous
            </Button>
            <span className={`tabular-nums ${TEXT_SUBTLE}`}>
              {page + 1} / {pages.length}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= pages.length - 1}
              onClick={() => setPage((p) => Math.min(pages.length - 1, p + 1))}
            >
              Next
            </Button>
          </div>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {pages.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="Nothing to show yet"
            description="This resource is still being prepared. It will appear here once it is ready."
          />
        ) : (
          // A page-like measure: generous side padding and a capped line length,
          // so long documents stay readable instead of running edge to edge.
          <article className="mx-auto max-w-[68ch] px-6 py-6 text-[13.5px] text-slate-700 dark:text-slate-300">
            {resource.format === "markdown" ? (
              <ReactMarkdown urlTransform={documentUrlTransform} components={DOC_COMPONENTS}>
                {body}
              </ReactMarkdown>
            ) : (
              <div className="space-y-2">
                {lines.map((line, i) => {
                  const heading = headingOf(line);
                  if (heading) {
                    return (
                      <h4
                        key={i}
                        className="pt-3 text-[13px] font-semibold text-slate-900 dark:text-white"
                      >
                        {heading}
                      </h4>
                    );
                  }
                  if (!line.trim()) return <div key={i} className="h-2" />;
                  return (
                    <p key={i} className="whitespace-pre-wrap leading-[1.75]">
                      {line}
                    </p>
                  );
                })}
              </div>
            )}
          </article>
        )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------ ask panel */

function messageText(message: UIMessage): string {
  return message.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
}

function extractFollowups(message: UIMessage): FollowupData | null {
  for (const part of message.parts) {
    if ((part as { type?: string }).type === "data-followups") {
      return (part as { data?: FollowupData }).data ?? null;
    }
  }
  return null;
}

/** Same normalisation the chat screen uses, so a suggestion is offered once. */
function normalizeQuestion(q: string): string {
  return q
    .trim()
    .toLowerCase()
    .replace(/[?.!\s]+$/, "");
}

/**
 * "Ask about this resource".
 *
 * Every question sent from here carries the open resource, and the server
 * answers from that resource alone — it does not fall back to the department,
 * to company-wide policy, or to any other resource. When the resource has no
 * answer it says so, and the conversation stays where it is.
 */
function AskPanel({ resource }: { resource: ResourceDetail }) {
  const [input, setInput] = useState("");
  const [asked, setAsked] = useState<Set<string>>(new Set());
  const bottomRef = useRef<HTMLDivElement>(null);

  // The open resource, read by the transport at send time. A ref so changing
  // resource never re-creates the transport mid-stream.
  const resourceIdRef = useRef(resource.id);
  resourceIdRef.current = resource.id;

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/admin/library/chat",
        // The console API is Bearer-authenticated and tokens are short-lived,
        // so one is fetched per send rather than captured once at mount.
        prepareSendMessagesRequest: async ({ messages, body }) => {
          const token = await getToken();
          const headers: Record<string, string> = {};
          if (token) headers.authorization = `Bearer ${token}`;
          return {
            body: { ...body, messages, resourceId: resourceIdRef.current },
            headers,
          };
        },
      }),
    [],
  );

  const { messages, sendMessage, status, error, setMessages } = useChat({ transport });

  const isLoading = status === "submitted" || status === "streaming";

  // Switching resource starts a new conversation: history about one resource
  // must never be carried into another.
  useEffect(() => {
    setMessages([]);
    setAsked(new Set());
    setInput("");
  }, [resource.id, setMessages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, status]);

  const submit = (text: string) => {
    const t = text.trim();
    if (!t || isLoading || !resource.ready) return;
    setAsked((prev) => new Set(prev).add(normalizeQuestion(t)));
    setInput("");
    void sendMessage({ text: t });
  };

  const lastAnswer = [...messages].reverse().find((m) => m.role === "assistant");
  const followups = lastAnswer && !isLoading ? extractFollowups(lastAnswer) : null;
  const suggestions = (followups?.suggestions ?? []).filter(
    (s) => !asked.has(normalizeQuestion(s)),
  );

  return (
    <section className={`${CARD} flex max-h-[calc(100vh-14rem)] flex-col overflow-hidden`}>
      <header className="flex items-center gap-2.5 border-b border-slate-100 px-5 py-3.5 dark:border-white/[0.06]">
        <span
          className="flex h-7 w-7 items-center justify-center rounded-lg text-white"
          style={{ background: TILE_GRADIENT }}
        >
          <Sparkles className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0">
          <h3 className={TEXT_SECTION}>Ask about this resource</h3>
          <p className={`truncate ${TEXT_SUBTLE}`}>Answers come only from {resource.title}</p>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {messages.length === 0 && !isLoading ? (
          <EmptyState
            icon={Sparkles}
            title={resource.ready ? "Ask your first question" : "This resource is still preparing"}
            description={
              resource.ready
                ? "Questions are answered from this resource only — nothing else is searched."
                : "You can read it now. Questions become available once it is ready."
            }
          />
        ) : (
          <div className="space-y-4">
            {messages.map((m) =>
              m.role === "user" ? (
                <div key={m.id} className="flex justify-end">
                  <p
                    className="max-w-[85%] rounded-2xl rounded-br-md px-3.5 py-2 text-[13px] text-white"
                    style={{ background: BRAND }}
                  >
                    {messageText(m)}
                  </p>
                </div>
              ) : (
                <div key={m.id} className={`${SURFACE_SUNK} px-4 py-3`}>
                  <div className="prose prose-sm max-w-none text-[13px] leading-[1.7] text-slate-800 dark:prose-invert dark:text-slate-100">
                    <ReactMarkdown>{messageText(m) || "…"}</ReactMarkdown>
                  </div>
                  <p className={`mt-2.5 flex items-center gap-1.5 ${TEXT_SUBTLE}`}>
                    <FileText className="h-3 w-3" />
                    Source: {resource.title}
                  </p>
                </div>
              ),
            )}

            {status === "submitted" && (
              <p className={`flex items-center gap-2 ${TEXT_MUTED}`}>
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-slate-400" />
                Reading this resource…
              </p>
            )}

            {error && (
              <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-300">
                Something went wrong. Please try again.
              </p>
            )}

            {suggestions.length > 0 && (
              <div className="space-y-1.5 pt-1">
                <p className={TEXT_EYEBROW}>Related questions</p>
                {suggestions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => submit(s)}
                    className={`flex w-full items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-left text-[12.5px] text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 dark:border-white/10 dark:text-slate-200 dark:hover:bg-white/[0.04] ${FOCUS_RING}`}
                  >
                    <CornerDownLeft className="h-3 w-3 shrink-0 text-slate-400" />
                    <span className="min-w-0 flex-1 truncate">{s}</span>
                  </button>
                ))}
              </div>
            )}

            <div ref={bottomRef} />
          </div>
        )}
      </div>

      <div className="border-t border-slate-100 p-3 dark:border-white/[0.06]">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit(input);
          }}
          className="flex items-center gap-2"
        >
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={resource.ready ? "Ask about this resource…" : "Not ready yet"}
            disabled={!resource.ready || isLoading}
            aria-label="Ask about this resource"
          />
          <Button type="submit" size="sm" disabled={!input.trim() || isLoading || !resource.ready}>
            Ask
          </Button>
        </form>
      </div>
    </section>
  );
}
