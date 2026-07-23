import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  BarChart3,
  Building2,
  ChevronRight,
  FileText,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu,
  MessagesSquare,
  Moon,
  PanelLeft,
  PanelLeftClose,
  RefreshCw,
  Search,
  Settings as SettingsIcon,
  Sparkles,
  Sun,
  Users as UsersIcon,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { api } from "@/lib/api/client";
import { signOut } from "@/lib/auth/client";
import { ChangePasswordDialog } from "@/components/admin/change-password-dialog";
import {
  BRAND,
  FOCUS_RING,
  HEADER_GRADIENT,
  initials,
  PAGE_BG,
  TILE_GRADIENT,
} from "@/components/admin/theme";
import { LoadingBlock } from "@/components/admin/states";

export const Route = createFileRoute("/admin")({
  component: AdminLayout,
});

/**
 * Navigation, in the order the work happens: what you look at, then what you
 * manage, then the tools. Flat rather than grouped — nine items read fine in one
 * column, and group headings cost vertical space without earning it here.
 */
const NAV = [
  { to: "/admin", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { to: "/admin/knowledge", label: "Knowledge", icon: FileText, exact: false },
  { to: "/admin/conversations", label: "Conversations", icon: MessagesSquare, exact: false },
  { to: "/admin/knowledge-gaps", label: "Knowledge Gaps", icon: Sparkles, exact: false },
  { to: "/admin/search", label: "Search", icon: Search, exact: false },
  { to: "/admin/analytics", label: "Analytics", icon: BarChart3, exact: false },
  { to: "/admin/departments", label: "Departments", icon: Building2, exact: false },
  { to: "/admin/users", label: "Users", icon: UsersIcon, exact: false, adminOnly: true },
  { to: "/admin/settings", label: "Settings", icon: SettingsIcon, exact: false, adminOnly: true },
] as const;

/** The signed-in user, from /api/me. Drives which navigation shows. */
interface Me {
  role: "super_admin" | "admin" | "team_leader";
  fullName: string | null;
  email: string | null;
}

const ROLE_LABEL: Record<Me["role"], string> = {
  super_admin: "super admin",
  admin: "administrator",
  team_leader: "team leader",
};

/** Users and Settings are the admin-only pages team leaders cannot reach. */
const ADMIN_ONLY_PREFIXES = ["/admin/users", "/admin/settings"];

/**
 * Whether a nav item matches the current path.
 *
 * Must compare on segment boundaries, not raw prefixes: "/admin/knowledge-gaps"
 * startsWith "/admin/knowledge", so a plain prefix test lights up both Knowledge
 * and Knowledge Gaps at once. A child route (/admin/knowledge/$id) still matches
 * its parent, because the boundary is the slash.
 */
function isActive(pathname: string, to: string, exact: boolean): boolean {
  if (exact) return pathname === to;
  return pathname === to || pathname.startsWith(`${to}/`);
}

/** Path → breadcrumb label. Detail routes inherit their parent's label. */
const CRUMBS: Record<string, string> = {
  "/admin": "Dashboard",
  "/admin/knowledge": "Knowledge",
  "/admin/conversations": "Conversations",
  "/admin/knowledge-gaps": "Knowledge Gaps",
  "/admin/departments": "Departments",
  "/admin/users": "Users",
  "/admin/search": "Search Playground",
  "/admin/analytics": "Analytics",
  "/admin/settings": "Settings",
};

function AdminLayout() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [dark, setDark] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  // Same mechanism the chat screen uses, so the toggle agrees across the app.
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  // Collapse preference survives navigation and reload.
  useEffect(() => {
    setCollapsed(localStorage.getItem("admin:sidebar") === "collapsed");
  }, []);

  function toggleCollapsed() {
    setCollapsed((c) => {
      localStorage.setItem("admin:sidebar", c ? "expanded" : "collapsed");
      return !c;
    });
  }

  // Doubles as the guard: /api/me 401s without a token and 403s for a suspended
  // account. Every console role (team leader, admin, super admin) may read it, so
  // it also tells us which navigation to show.
  const {
    data: me,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ["me"],
    queryFn: () => api.get<Me>("/api/me"),
    retry: false,
  });

  if (isLoading) {
    return (
      <div className={`min-h-screen ${PAGE_BG}`}>
        <LoadingBlock label="Checking your session…" />
      </div>
    );
  }

  if (isError) {
    const status = (error as { status?: number })?.status;
    return (
      <div className={`flex min-h-screen items-center justify-center px-4 ${PAGE_BG}`}>
        <div className="max-w-sm text-center">
          <h1 className="text-lg font-semibold text-slate-900 dark:text-white">
            {status === 403 ? "Account unavailable" : "Please sign in"}
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {status === 403
              ? "Your account is suspended. Contact an administrator."
              : "Your session has expired or you’re not signed in."}
          </p>
          <div className="mt-4 flex justify-center gap-2">
            <Button
              onClick={() => navigate({ to: "/login" })}
              style={{ background: BRAND }}
              className="text-white"
            >
              Go to sign in
            </Button>
            <Button variant="outline" onClick={() => navigate({ to: "/" })}>
              Back to chat
            </Button>
          </div>
        </div>
      </div>
    );
  }
  const role = me?.role;
  // Only admins and super admins reach Users and Settings; team leaders get every
  // other page. The API enforces the same split — this just hides what they can't use.
  const isAdmin = role === "admin" || role === "super_admin";
  const visibleNav = NAV.filter((item) => isAdmin || !("adminOnly" in item && item.adminOnly));
  const blockedFromPage =
    !isAdmin && ADMIN_ONLY_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  // Same boundary rule as the nav, so a detail route shows its parent's label
  // without "/admin/knowledge-gaps/x" ever resolving to "Knowledge".
  const parentCrumb = Object.keys(CRUMBS)
    .filter((p) => p !== "/admin" && isActive(pathname, p, false))
    .sort((a, b) => b.length - a.length)[0];
  const currentLabel = CRUMBS[pathname] ?? (parentCrumb ? CRUMBS[parentCrumb] : "Admin");

  async function handleSignOut() {
    await signOut();
    await navigate({ to: "/login" });
  }

  const nav = (
    <nav aria-label="Admin sections" className="flex h-full flex-col p-3">
      <div className="flex flex-col gap-1">
        {visibleNav.map((item) => {
          const active = isActive(pathname, item.to, item.exact);
          return (
            <Link
              key={item.to}
              to={item.to}
              onClick={() => setMobileOpen(false)}
              aria-current={active ? "page" : undefined}
              title={collapsed ? item.label : undefined}
              className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-150 ${FOCUS_RING} ${
                active
                  ? "bg-[#2b6cf3] text-white shadow-[0_2px_8px_rgba(43,108,243,0.35)]"
                  : "text-white/60 hover:bg-white/[0.06] hover:text-white"
              } ${collapsed ? "justify-center px-0" : ""}`}
            >
              <item.icon className="h-[18px] w-[18px] shrink-0 transition-transform group-hover:scale-110" />
              {!collapsed && <span className="truncate">{item.label}</span>}
            </Link>
          );
        })}
      </div>

      <div className="mt-auto flex flex-col gap-1 border-t border-white/[0.08] pt-3">
        <button
          type="button"
          onClick={toggleCollapsed}
          className={`hidden w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-white/50 transition hover:bg-white/[0.06] hover:text-white lg:flex ${FOCUS_RING} ${collapsed ? "justify-center px-0" : ""}`}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? (
            <PanelLeft className="h-[18px] w-[18px]" />
          ) : (
            <PanelLeftClose className="h-[18px] w-[18px]" />
          )}
          {!collapsed && <span>Collapse</span>}
        </button>
        <button
          type="button"
          onClick={handleSignOut}
          className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-white/60 transition hover:bg-white/[0.06] hover:text-white ${FOCUS_RING} ${collapsed ? "justify-center px-0" : ""}`}
        >
          <LogOut className="h-[18px] w-[18px] shrink-0" />
          {!collapsed && <span>Sign out</span>}
        </button>
      </div>
    </nav>
  );

  return (
    <div className={`min-h-screen ${PAGE_BG}`}>
      <header
        className="fixed inset-x-0 top-0 z-40 h-16 border-b border-white/10"
        style={{ background: HEADER_GRADIENT }}
      >
        <div className="flex h-full items-center gap-3 px-3 sm:px-4">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-white hover:bg-white/10 lg:hidden"
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen((v) => !v)}
          >
            {mobileOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </Button>

          <Link to="/admin" className={`flex items-center gap-2.5 rounded ${FOCUS_RING}`}>
            <div
              className="flex h-9 w-9 items-center justify-center rounded-xl text-sm font-black text-white"
              style={{ background: TILE_GRADIENT }}
            >
              D
            </div>
            <span className="hidden leading-tight sm:block">
              <span className="block text-sm font-semibold text-white">Ask the Digit</span>
              <span className="block text-[11px] text-white/50">Admin Console</span>
            </span>
          </Link>

          <div className="ml-auto flex items-center gap-2">
            {/* Sends you to the retrieval playground — the only search the admin
                console actually has. Labelled for what it does, not "everything". */}
            <button
              type="button"
              onClick={() => navigate({ to: "/admin/search" })}
              className={`hidden h-9 w-64 items-center gap-2 rounded-full border border-white/15 bg-white/[0.07] px-3.5 text-xs text-white/50 transition hover:bg-white/[0.12] hover:text-white/80 md:flex ${FOCUS_RING}`}
            >
              <Search className="h-3.5 w-3.5" />
              Search knowledge…
            </button>

            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 rounded-full text-white/70 hover:bg-white/10 hover:text-white"
              aria-label="Refresh data"
              // Invalidates everything: the header cannot know which queries the
              // current page owns, and refetching them all is cheap.
              onClick={() => void qc.invalidateQueries()}
            >
              <RefreshCw className="h-4 w-4" />
            </Button>

            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 rounded-full text-white/70 hover:bg-white/10 hover:text-white"
              aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
              onClick={() => setDark((d) => !d)}
            >
              {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>

            <Button
              asChild
              size="sm"
              className="h-9 rounded-full bg-white text-[#15243D] hover:bg-white/90"
            >
              <Link to="/">Open chat</Link>
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className={`flex h-9 w-9 items-center justify-center rounded-full text-[11px] font-semibold text-white ring-1 ring-white/20 transition hover:ring-white/40 ${FOCUS_RING}`}
                  style={{ background: TILE_GRADIENT }}
                  aria-label="Account menu"
                >
                  {initials(me?.fullName ?? me?.email ?? "User")}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuLabel className="text-xs font-normal text-slate-500">
                  Signed in as {role ? ROLE_LABEL[role] : "…"}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setPasswordOpen(true)}>
                  <KeyRound className="mr-2 h-4 w-4" />
                  Change password
                </DropdownMenuItem>
                {isAdmin && (
                  <DropdownMenuItem onClick={() => navigate({ to: "/admin/settings" })}>
                    <SettingsIcon className="mr-2 h-4 w-4" />
                    Settings
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleSignOut} className="text-red-600">
                  <LogOut className="mr-2 h-4 w-4" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      <aside
        className={`fixed bottom-0 left-0 top-16 z-30 hidden border-r border-white/[0.06] transition-[width] duration-200 lg:block ${
          collapsed ? "w-[68px]" : "w-60"
        }`}
        style={{ background: BRAND }}
      >
        {nav}
      </aside>

      {mobileOpen && (
        <>
          <div
            className="fixed inset-0 top-16 z-30 bg-black/50 backdrop-blur-sm lg:hidden"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />
          <aside
            className="fixed bottom-0 left-0 top-16 z-30 w-60 border-r border-white/[0.06] lg:hidden"
            style={{ background: BRAND }}
          >
            {nav}
          </aside>
        </>
      )}

      <main
        className={`px-4 pb-12 pt-[88px] transition-[padding] duration-200 sm:px-6 ${
          collapsed ? "lg:pl-[92px]" : "lg:pl-[264px]"
        }`}
      >
        {blockedFromPage ? (
          <div className="mx-auto max-w-sm py-24 text-center">
            <h1 className="text-lg font-semibold text-slate-900 dark:text-white">
              This page is restricted
            </h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Your role doesn’t have access to this page. Choose another section from the menu.
            </p>
            <Button className="mt-4" onClick={() => navigate({ to: "/admin" })}>
              Back to dashboard
            </Button>
          </div>
        ) : (
          <Outlet />
        )}
      </main>

      <ChangePasswordDialog open={passwordOpen} onOpenChange={setPasswordOpen} />
    </div>
  );
}
