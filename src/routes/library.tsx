import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown, { defaultUrlTransform, type Components } from "react-markdown";
import {
  BookOpen,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
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
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { getToken } from "@/lib/auth/client";
import { useDebounced } from "@/hooks/use-debounced";
import { EmptyState, ErrorState } from "@/components/admin/states";
import {
  BRAND,
  CARD,
  FOCUS_RING,
  HEADER_GRADIENT,
  PAGE_BG,
  SURFACE_SUNK,
  TEXT_EYEBROW,
  TEXT_MUTED,
  TEXT_SECTION,
  TEXT_SUBTLE,
  TILE_GRADIENT,
  TONE,
} from "@/components/admin/theme";

export const Route = createFileRoute("/library")({
  component: DocumentLibraryPage,
});

/**
 * The user-facing Document Library — a SEPARATE feature from /admin/library.
 *
 * That page reads knowledge_folders/knowledge_documents (files uploaded and
 * chunked by an admin). This page reads a Google Sheet and Google Drive
 * directly: the hierarchy and every document come from the sheet's own
 * hyperlinks, and a click fetches the real Drive file, server-side, on demand.
 *
 * Nothing here calls retrieval.service.ts, touches knowledge_chunks, or shares
 * a request path with /api/chat or /api/admin/library/chat. Asking a question
 * always goes through /api/library/ask, which puts the ONE selected
 * document's whole text in the prompt — see library-ai.server.ts.
 */

/* ------------------------------------------------------------------ types */

type NodeKind = "root" | "platform" | "model" | "section" | "method" | "document";

interface TreeNodeData {
  id: string;
  name: string;
  owner: string | null;
  kind: NodeKind;
  isDocument: boolean;
  /** A folder this deployment cannot list yet — no Google service account
   *  configured. Shown distinctly from a folder that is genuinely empty. */
  pending: boolean;
  children: TreeNodeData[];
}

interface DocumentDetail {
  id: string;
  name: string;
  path: string[];
  owner: string | null;
  format: "markdown" | "pdf";
  text: string | null;
  ready: boolean;
}

/* ------------------------------------------------------------------ page */

function DocumentLibraryPage() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const query = useDebounced(search);

  const tree = useQuery({
    queryKey: ["doc-library-tree"],
    queryFn: () => authedGet<{ tree: TreeNodeData }>("/api/library/tree"),
  });

  const document = useQuery({
    queryKey: ["doc-library-document", selectedId],
    queryFn: () =>
      authedGet<DocumentDetail>(`/api/library/document/${encodeURIComponent(selectedId!)}`),
    enabled: !!selectedId,
  });

  const unauthorized = isUnauthorized(tree.error) || isUnauthorized(document.error);

  return (
    <div className={`relative flex min-h-screen flex-col ${PAGE_BG}`}>
      <header
        className="flex h-14 shrink-0 sm:h-16 items-center justify-between border-b border-white/10 px-3 shadow-lg shadow-slate-900/10 sm:px-5"
        style={{ background: HEADER_GRADIENT }}
      >
        <div className="flex items-center gap-3">
          <span
            className="flex h-11 w-11 items-center justify-center rounded-xl text-xl font-black text-white shadow-lg"
            style={{ background: TILE_GRADIENT }}
          >
            D
          </span>
          <div className="leading-tight">
            <div className="text-[14px] font-semibold text-white">Ask the Digit</div>
            <div className="text-[11px] text-white/60">Document Library</div>
          </div>
        </div>
        <Button
          asChild
          variant="outline"
          size="sm"
          className="rounded-full border-white/15 bg-white/5 text-white hover:bg-white/15 hover:text-white"
        >
          <Link to="/">Back to Chat</Link>
        </Button>
      </header>

      <main className="mx-auto w-full min-w-0 max-w-[1920px] flex-1 px-3 py-3 sm:px-4 lg:px-5">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <p className={TEXT_EYEBROW}>Your team’s resources</p>
            <h1 className="mt-1 text-xl font-semibold tracking-tight text-slate-900 dark:text-white sm:text-2xl">
              Document Library
            </h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Explore your guides, read the details, and find answers in one place.
            </p>
          </div>
          <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 dark:border-white/10 dark:bg-slate-900 dark:text-slate-300">
            <BookOpen className="h-3.5 w-3.5" /> Read &amp; ask
          </span>
        </div>
        {unauthorized ? (
          <div className={`${CARD} mx-auto max-w-md`}>
            <EmptyState
              icon={Library}
              title="Sign in required"
              description="The Document Library reads internal operational documents, so it needs you to sign in first."
              action={
                <Button asChild size="sm">
                  <Link to="/login">Sign in</Link>
                </Button>
              }
            />
          </div>
        ) : (
          <div
            className={`grid min-w-0 gap-3 md:items-start ${sidebarCollapsed ? "md:grid-cols-[48px_minmax(0,1fr)]" : "md:grid-cols-[240px_minmax(0,1fr)] xl:grid-cols-[280px_minmax(0,1fr)]"}`}
          >
            <aside aria-label="Document navigation" className="min-w-0 md:sticky md:top-3">
              <div
                className={`${CARD} mb-2 flex items-center p-1 ${sidebarCollapsed ? "justify-center" : "justify-between"}`}
              >
                {!sidebarCollapsed && (
                  <span className="pl-2 text-xs font-medium text-slate-600 dark:text-slate-300">
                    Document navigation
                  </span>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size={sidebarCollapsed ? "sm" : "icon"}
                  onClick={() => setSidebarCollapsed((value) => !value)}
                  aria-expanded={!sidebarCollapsed}
                  aria-controls="library-folder-sidebar"
                  aria-label={
                    sidebarCollapsed ? "Expand folder sidebar" : "Collapse folder sidebar"
                  }
                  title={sidebarCollapsed ? "Expand folder sidebar" : "Collapse folder sidebar"}
                  className="shrink-0 gap-2 text-slate-600 dark:text-slate-300"
                >
                  {sidebarCollapsed ? (
                    <PanelLeftOpen className="h-4 w-4" />
                  ) : (
                    <PanelLeftClose className="h-4 w-4" />
                  )}
                  {sidebarCollapsed && <span className="md:hidden">Browse documents</span>}
                </Button>
              </div>
              <div id="library-folder-sidebar" hidden={sidebarCollapsed}>
                {tree.isLoading ? (
                  <LibraryLoading navigation />
                ) : tree.error ? (
                  <div className={CARD}>
                    <ErrorState error={tree.error} onRetry={() => void tree.refetch()} />
                    {/* The Document Library reads the Google Sheet live, so a
                      Google-side outage can fail this load even when nothing
                      in our own app is broken. Every role that can reach this
                      page already satisfies the admin console's own gate
                      (team_leader/admin/super_admin), so this is always a
                      valid destination for whoever is looking at this error —
                      never a data merge, just a pointer to an unaffected,
                      database-backed alternative while Google recovers. */}
                    <p className={`pb-5 text-center ${TEXT_SUBTLE}`}>
                      Documents already in the admin console are unaffected —{" "}
                      <Link
                        to="/admin/library"
                        className="text-[#2b6cf3] underline underline-offset-2"
                      >
                        open the Knowledge Library
                      </Link>
                      .
                    </p>
                  </div>
                ) : (
                  <TreeBrowser
                    root={tree.data!.tree}
                    search={search}
                    query={query}
                    onSearch={setSearch}
                    selectedId={selectedId}
                    onSelect={setSelectedId}
                  />
                )}
              </div>
            </aside>

            {!selectedId ? (
              <LibraryWelcome />
            ) : document.isLoading ? (
              <LibraryLoading />
            ) : document.error ? (
              <div className={CARD}>
                <ErrorState error={document.error} onRetry={() => void document.refetch()} />
              </div>
            ) : (
              <DocumentWorkspace key={document.data!.id} document={document.data!} />
            )}
          </div>
        )}
      </main>
    </div>
  );
}

/** Match the loaded panels so slow requests do not collapse the workspace. */
function LibraryLoading({ navigation = false }: { navigation?: boolean }) {
  return (
    <div
      className={`${CARD} min-w-0 overflow-hidden ${navigation ? "h-[40dvh] md:h-[max(200px,calc(100dvh-15rem))]" : "min-h-[min(440px,60dvh)]"}`}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <span className="sr-only">
        {navigation ? "Loading the library…" : "Opening the document…"}
      </span>
      <div
        className="space-y-3 border-b border-slate-100 p-5 dark:border-white/10"
        aria-hidden="true"
      >
        <Skeleton className="h-4 w-32 motion-reduce:animate-none" />
        <Skeleton className="h-10 w-full rounded-lg motion-reduce:animate-none" />
      </div>
      <div className="space-y-5 p-5" aria-hidden="true">
        {Array.from({ length: navigation ? 8 : 6 }, (_, i) => (
          <div
            key={i}
            className={`flex items-center gap-3 ${navigation && i % 3 !== 0 ? "ml-5" : ""}`}
          >
            {navigation && (
              <Skeleton className="h-6 w-6 shrink-0 rounded-md motion-reduce:animate-none" />
            )}
            <div className="flex-1 space-y-2">
              <Skeleton
                className={`h-3.5 motion-reduce:animate-none ${i % 2 ? "w-3/4" : "w-full"}`}
              />
              {!navigation && <Skeleton className="h-3 w-5/6 motion-reduce:animate-none" />}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function LibraryWelcome() {
  return (
    <section
      className={`${CARD} flex min-w-0 flex-col overflow-hidden md:min-h-[min(440px,60dvh)]`}
      aria-labelledby="library-welcome"
    >
      <div className="relative flex flex-1 flex-col items-center justify-center bg-gradient-to-br from-slate-100/80 via-white to-slate-50 px-4 py-7 text-center dark:from-slate-800/50 dark:via-slate-900 dark:to-slate-900 sm:px-6">
        <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl border border-slate-200 bg-white text-[#15243D] shadow-sm dark:border-white/10 dark:bg-slate-800 dark:text-slate-200">
          <Library className="h-9 w-9" strokeWidth={1.5} />
        </div>
        <p className="text-xs font-semibold uppercase tracking-widest text-[#2b4a82] dark:text-[#8FB0E8]">
          A space to explore
        </p>
        <h2
          id="library-welcome"
          className="mt-2 max-w-md text-xl font-semibold tracking-tight text-slate-900 dark:text-white sm:text-2xl"
        >
          Your next answer starts with a document.
        </h2>
        <p className="mt-2 max-w-md text-sm leading-6 text-slate-500 dark:text-slate-400">
          Browse a platform and model in the library, then choose a document to open your reading
          workspace.
        </p>
        <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/80 px-4 py-2 text-xs text-slate-500 dark:border-white/10 dark:bg-slate-800 dark:text-slate-300">
          <Search className="h-3.5 w-3.5" /> Looking for something? Search by name or owner.
        </div>
      </div>
      <div className="grid gap-4 border-t border-slate-100 p-4 dark:border-white/10 sm:grid-cols-3 sm:p-5">
        {[
          {
            icon: Folder,
            title: "01 · Explore",
            text: "Find the platform and model you work with.",
          },
          {
            icon: BookOpen,
            title: "02 · Read",
            text: "Open a guide and keep the details in view.",
          },
          {
            icon: Sparkles,
            title: "03 · Ask",
            text: "Get answers based on the selected document.",
          },
        ].map(({ icon: Icon, title, text }) => (
          <div key={title} className="min-w-0">
            <Icon className="mb-3 h-5 w-5 text-[#2b4a82] dark:text-[#8FB0E8]" strokeWidth={1.5} />
            <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{title}</h3>
            <p className="mt-2 text-xs leading-6 text-slate-500 dark:text-slate-400">{text}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

/* --------------------------------------------------------------- fetching */

class LibraryHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function isUnauthorized(error: unknown): boolean {
  return error instanceof LibraryHttpError && (error.status === 401 || error.status === 403);
}

/** Attaches the console session's Bearer token — this page reuses the SAME
 *  sign-in as the admin console; there is no separate "normal user" account
 *  type in this application today. */
async function authedGet<T>(path: string): Promise<T> {
  const token = await getToken();
  const response = await fetch(path, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message = (body as { error?: { message?: string } })?.error?.message ?? "Request failed";
    throw new LibraryHttpError(response.status, message);
  }
  return body as T;
}

/* --------------------------------------------------------------- browser */

const KIND_ICON: Record<NodeKind, typeof Folder> = {
  root: Library,
  platform: Store,
  model: Layers,
  section: Folder,
  method: BookOpen,
  document: FileText,
};

function TreeBrowser({
  root,
  search,
  query,
  onSearch,
  selectedId,
  onSelect,
}: {
  root: TreeNodeData;
  search: string;
  query: string;
  onSearch: (v: string) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const needle = query.trim().toLowerCase();

  const matching = useMemo(() => {
    if (!needle) return null;
    const hits = new Set<string>();
    const walk = (node: TreeNodeData): boolean => {
      const childHit = node.children.map(walk).some(Boolean);
      const selfHit =
        node.name.toLowerCase().includes(needle) ||
        (node.owner ?? "").toLowerCase().includes(needle);
      if (selfHit || childHit) hits.add(node.id);
      return selfHit || childHit;
    };
    walk(root);
    return hits;
  }, [needle, root]);

  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const initialised = useRef(false);
  useEffect(() => {
    if (initialised.current) return;
    initialised.current = true;
    setExpanded(new Set(root.children.filter((c) => c.kind === "platform").map((c) => c.id)));
  }, [root]);

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const nothingMatched = matching !== null && matching.size === 0;

  return (
    <div
      className={`${CARD} flex h-[40dvh] min-w-0 flex-col overflow-hidden md:h-[max(200px,calc(100dvh-15rem))]`}
    >
      <div className="shrink-0 border-b border-slate-100 bg-slate-50/60 p-3 dark:border-white/[0.06] dark:bg-white/[0.02]">
        <div className="mb-2 flex items-center gap-2">
          <Library className="h-4 w-4 text-[#2b4a82] dark:text-[#8FB0E8]" />
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Browse documents</h2>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search documents…"
            className="h-10 rounded-lg bg-white pl-9 pr-9 shadow-none dark:bg-slate-900"
            aria-label="Search documents"
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

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2.5">
        {nothingMatched ? (
          <p className={`px-3 py-8 text-center ${TEXT_MUTED}`}>Nothing matches "{search}".</p>
        ) : (
          root.children.map((child) => (
            <Node
              key={child.id}
              node={child}
              depth={0}
              expanded={expanded}
              onToggle={toggle}
              matching={matching}
              selectedId={selectedId}
              onSelect={onSelect}
            />
          ))
        )}
      </div>
    </div>
  );
}

function Node({
  node,
  depth,
  expanded,
  onToggle,
  matching,
  selectedId,
  onSelect,
}: {
  node: TreeNodeData;
  depth: number;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  matching: Set<string> | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  if (matching && !matching.has(node.id)) return null;

  if (node.isDocument) {
    const selected = node.id === selectedId;
    return (
      <button
        type="button"
        title={node.name}
        onClick={() => onSelect(node.id)}
        style={{ paddingLeft: 8 + Math.min(depth, 5) * 12 + 20 }}
        aria-current={selected ? "true" : undefined}
        className={`flex w-full items-center gap-2 rounded-lg py-2.5 pr-2 text-left transition ${FOCUS_RING} ${
          selected
            ? "bg-[#15243D]/[0.07] font-medium text-[#15243D] ring-1 ring-inset ring-[#15243D]/15 dark:bg-white/10 dark:text-white dark:ring-white/15"
            : "hover:bg-slate-50 dark:hover:bg-white/[0.04]"
        }`}
      >
        <FileText className={`h-4 w-4 shrink-0 ${selected ? "" : "text-slate-400"}`} />
        <span className="min-w-0 flex-1 truncate text-[13px]">{node.name}</span>
      </button>
    );
  }

  const isOpen = matching !== null || expanded.has(node.id);
  const hasChildren = node.children.length > 0;
  const Icon = KIND_ICON[node.kind];

  return (
    <div>
      <button
        type="button"
        title={node.name}
        onClick={() => hasChildren && onToggle(node.id)}
        style={{ paddingLeft: 8 + Math.min(depth, 5) * 12 }}
        className={`flex w-full items-center gap-2 rounded-lg py-2.5 pr-2 text-left transition hover:bg-slate-50 dark:hover:bg-white/[0.04] ${FOCUS_RING}`}
        aria-expanded={hasChildren ? isOpen : undefined}
      >
        <ChevronRight
          className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform ${isOpen ? "rotate-90" : ""} ${
            hasChildren ? "" : "invisible"
          }`}
        />
        {node.kind === "platform" ? (
          <span
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-white"
            style={{ background: TILE_GRADIENT }}
          >
            <Icon className="h-3.5 w-3.5" />
          </span>
        ) : (
          <Icon className="h-4 w-4 shrink-0 text-slate-400" />
        )}
        <span className="min-w-0 flex-1">
          <span
            className={`block truncate text-[13px] ${
              node.kind === "platform"
                ? "font-semibold text-slate-900 dark:text-white"
                : "text-slate-700 dark:text-slate-200"
            }`}
          >
            {node.name}
          </span>
          {node.owner && <span className={`block truncate ${TEXT_SUBTLE}`}>{node.owner}</span>}
        </span>
        {node.pending && (
          <span
            className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${TONE.amber.fg} ${TONE.amber.bg}`}
          >
            pending
          </span>
        )}
      </button>

      {isOpen && (
        <div>
          {node.pending && node.children.length === 0 && (
            <p style={{ paddingLeft: 8 + (depth + 1) * 14 + 20 }} className={`py-1 ${TEXT_SUBTLE}`}>
              Needs Google Drive access to list this folder.
            </p>
          )}
          {node.children.map((child) => (
            <Node
              key={child.id}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              onToggle={onToggle}
              matching={matching}
              selectedId={selectedId}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------- workspace */

function DocumentWorkspace({ document }: { document: DocumentDetail }) {
  const [chatOpen, setChatOpen] = useState(false);
  const chatToggleRef = useRef<HTMLButtonElement>(null);
  return (
    <div className="min-w-0 space-y-3">
      <div className={`${CARD} p-3 sm:p-4`}>
        <nav aria-label="Location" className="flex flex-wrap items-center gap-1.5">
          {document.path.map((name, i) => (
            <span key={`${name}-${i}`} className="flex min-w-0 items-center gap-1.5">
              {i > 0 && <ChevronRight className="h-3 w-3 text-slate-300 dark:text-slate-600" />}
              <span className={`${TEXT_SUBTLE} break-words [overflow-wrap:anywhere]`}>{name}</span>
            </span>
          ))}
        </nav>
        <h2 className="mt-3 break-words text-xl font-semibold tracking-[-0.01em] text-slate-900 dark:text-white">
          {document.name}
        </h2>
        {document.owner && <p className={`mt-1 ${TEXT_MUTED}`}>{document.owner}</p>}
        <Button
          ref={chatToggleRef}
          type="button"
          variant={chatOpen ? "outline" : "default"}
          className="mt-4 gap-2"
          aria-expanded={chatOpen}
          aria-controls="document-chat-panel"
          onClick={() => setChatOpen((open) => !open)}
        >
          <Sparkles className="h-4 w-4" />
          {chatOpen ? "Hide chat" : "Ask this document"}
        </Button>
      </div>

      <div
        className={`grid min-w-0 gap-5 xl:items-start ${chatOpen ? "xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]" : "grid-cols-1"}`}
      >
        <DocumentViewer document={document} />
        <div id="document-chat-panel" hidden={!chatOpen} className="min-w-0">
          <AskPanel
            key={document.id}
            document={document}
            open={chatOpen}
            onClose={() => {
              setChatOpen(false);
              chatToggleRef.current?.focus();
            }}
          />
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- viewer */

const SAFE_IMAGE_DATA = /^data:image\/(png|jpe?g|gif|webp|bmp);base64,/i;
function urlTransform(url: string): string {
  if (SAFE_IMAGE_DATA.test(url)) return url;
  return defaultUrlTransform(url);
}

const DOC_COMPONENTS: Components = {
  h1: ({ children }) => (
    <h2 className="mt-7 border-b border-slate-200 pb-1.5 text-[17px] font-semibold text-slate-900 first:mt-0 dark:border-white/10 dark:text-white">
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
      className="text-[#2b6cf3] underline underline-offset-2"
    >
      {children}
    </a>
  ),
  img: ({ src, alt }) => (
    <img
      src={typeof src === "string" ? src : undefined}
      alt={alt ?? ""}
      loading="lazy"
      className="my-4 max-w-full rounded-lg border border-slate-200 shadow-sm dark:border-white/10"
    />
  ),
};

function DocumentViewer({ document }: { document: DocumentDetail }) {
  return (
    <section
      className={`${CARD} flex h-[clamp(240px,65dvh,680px)] min-w-0 flex-col overflow-hidden`}
    >
      <header className="flex items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/60 px-3 py-3 sm:px-4 dark:bg-white/[0.02] dark:border-white/[0.06]">
        <h3 className={`${TEXT_SECTION} flex items-center gap-2`}>
          <BookOpen className="h-4 w-4 text-blue-500" />
          Document
        </h3>
        <span className="rounded-md bg-slate-100 px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:bg-white/5 dark:text-slate-400">
          {document.format === "pdf" ? "PDF" : "Reading view"}
        </span>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {document.format === "pdf" ? (
          <iframe
            src={`/api/library/file/${encodeURIComponent(document.id)}`}
            title={document.name}
            className="h-full w-full border-0"
          />
        ) : !document.text ? (
          <EmptyState
            icon={FileText}
            title="Nothing to show yet"
            description="This document could not be read. It may still need Google Drive access to be configured."
          />
        ) : (
          <article className="mx-auto max-w-[68ch] break-words px-4 py-4 text-sm [overflow-wrap:anywhere] [&_pre]:overflow-x-auto sm:px-5 text-slate-700 dark:text-slate-300">
            <ReactMarkdown urlTransform={urlTransform} components={DOC_COMPONENTS}>
              {document.text}
            </ReactMarkdown>
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

/**
 * "Ask this document" — grounded ONLY in the currently open document.
 *
 * Switching documents remounts this whole panel (via `key={document.id}` at
 * the call site), which is what guarantees Document A's conversation can
 * never be sent alongside Document B's id: there is no shared component
 * instance for state to leak through.
 */
function AskPanel({
  document,
  open,
  onClose,
}: {
  document: DocumentDetail;
  open: boolean;
  onClose: () => void;
}) {
  const [input, setInput] = useState("");

  const documentIdRef = useRef(document.id);
  documentIdRef.current = document.id;

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/library/ask",
        prepareSendMessagesRequest: async ({ messages, body }) => {
          const token = await getToken();
          const headers: Record<string, string> = {};
          if (token) headers.authorization = `Bearer ${token}`;
          return {
            body: { ...body, messages, driveFileId: documentIdRef.current },
            headers,
          };
        },
      }),
    [],
  );

  const { messages, sendMessage, status, error } = useChat({ transport });
  const isLoading = status === "submitted" || status === "streaming";
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, status, open]);

  const submit = (text: string) => {
    const t = text.trim();
    if (!t || isLoading || !document.ready) return;
    setInput("");
    void sendMessage({ text: t });
  };

  return (
    <section
      className={`${CARD} flex h-[clamp(240px,65dvh,680px)] min-w-0 flex-col overflow-hidden`}
    >
      <header className="flex items-center gap-2.5 border-b border-slate-100 px-3 py-3 sm:px-4 dark:border-white/[0.06]">
        <span
          className="flex h-7 w-7 items-center justify-center rounded-lg text-white"
          style={{ background: TILE_GRADIENT }}
        >
          <Sparkles className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0">
          <h3 className={TEXT_SECTION}>Ask this document</h3>
          <p className={`truncate ${TEXT_SUBTLE}`}>Answers come only from {document.name}</p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="ml-auto shrink-0"
          onClick={onClose}
          aria-label="Close document chat"
          title="Close chat"
        >
          <X className="h-4 w-4" />
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3 sm:px-4">
        {messages.length === 0 && !isLoading ? (
          <EmptyState
            icon={Sparkles}
            title={document.ready ? "Ask your first question" : "This document is still preparing"}
            description={
              document.ready
                ? "Questions are answered from this document only — nothing else is searched."
                : "You can read it now. Questions become available once it is ready."
            }
          />
        ) : (
          <div className="space-y-4">
            {messages.map((m) =>
              m.role === "user" ? (
                <div key={m.id} className="flex justify-end">
                  <p
                    className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md px-3.5 py-2 text-[13px] text-white"
                    style={{ background: BRAND }}
                  >
                    {messageText(m)}
                  </p>
                </div>
              ) : (
                <div key={m.id} className={`${SURFACE_SUNK} px-4 py-3`}>
                  <div className="prose prose-sm max-w-none break-words [overflow-wrap:anywhere] text-[13px] leading-[1.7] text-slate-800 dark:prose-invert dark:text-slate-100">
                    <ReactMarkdown>{messageText(m) || "…"}</ReactMarkdown>
                  </div>
                  <p className={`mt-2.5 flex items-center gap-1.5 ${TEXT_SUBTLE}`}>
                    <FileText className="h-3 w-3" />
                    Source: {document.name}
                  </p>
                </div>
              ),
            )}
            {status === "submitted" && (
              <p className={`flex items-center gap-2 ${TEXT_MUTED}`}>
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-slate-400" />
                Reading this document…
              </p>
            )}
            {error && (
              <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-300">
                Something went wrong. Please try again.
              </p>
            )}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-slate-100 bg-slate-50/50 p-4 dark:border-white/[0.06]">
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
            placeholder={document.ready ? "Ask about this document…" : "Not ready yet"}
            disabled={!document.ready || isLoading}
            aria-label="Ask about this document"
          />
          <Button type="submit" size="sm" disabled={!input.trim() || isLoading || !document.ready}>
            <CornerDownLeft className="mr-1 h-3.5 w-3.5" />
            Ask
          </Button>
        </form>
      </div>
    </section>
  );
}
