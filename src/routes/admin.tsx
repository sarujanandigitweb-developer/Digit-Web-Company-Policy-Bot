import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  BarChart3,
  Building2,
  FileText,
  MessagesSquare,
  Settings as SettingsIcon,
  Sparkles,
  LayoutDashboard,
  LogOut,
  Menu,
  Search,
  Users as UsersIcon,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { api, type AdminUser } from "@/lib/api/client";
import { signOut } from "@/lib/auth/client";
import { BRAND, HEADER_GRADIENT, PAGE_BG, TILE_GRADIENT } from "@/components/admin/theme";
import { LoadingBlock } from "@/components/admin/states";

export const Route = createFileRoute("/admin")({
  component: AdminLayout,
});

const NAV = [
  { to: "/admin", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { to: "/admin/knowledge", label: "Knowledge", icon: FileText },
  { to: "/admin/conversations", label: "Conversations", icon: MessagesSquare },
  { to: "/admin/knowledge-gaps", label: "Knowledge Gaps", icon: Sparkles },
  { to: "/admin/search", label: "Search", icon: Search },
  { to: "/admin/analytics", label: "Analytics", icon: BarChart3 },
  { to: "/admin/departments", label: "Departments", icon: Building2 },
  { to: "/admin/users", label: "Users", icon: UsersIcon },
  { to: "/admin/settings", label: "Settings", icon: SettingsIcon },
];

/**
 * Shell for every admin screen: sidebar, header, and the auth guard.
 *
 * The guard is a convenience, not the security boundary — every admin API
 * independently verifies the JWT and the caller's role. This only stops an
 * unauthorised person from staring at an empty chrome.
 */
function AdminLayout() {
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  // Doubles as the guard: the API 401s without a valid token, and 403s for staff.
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["me"],
    queryFn: () => api.get<{ items: AdminUser[] }>("/api/admin/users?pageSize=1"),
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
    // 401 → not signed in. 403 → signed in as staff, who have no admin area.
    return (
      <div className={`flex min-h-screen items-center justify-center px-4 ${PAGE_BG}`}>
        <div className="max-w-sm text-center">
          <h1 className="text-lg font-semibold text-slate-900 dark:text-white">
            {status === 403 ? "Admins only" : "Please sign in"}
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {status === 403
              ? "Your account doesn’t have access to the admin area."
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

  void data;

  async function handleSignOut() {
    await signOut();
    await navigate({ to: "/login" });
  }

  const sidebar = (
    <nav aria-label="Admin sections" className="flex h-full flex-col gap-1 p-3">
      {NAV.map((item) => {
        const active = item.exact ? pathname === item.to : pathname.startsWith(item.to);
        return (
          <Link
            key={item.to}
            to={item.to}
            onClick={() => setMobileOpen(false)}
            aria-current={active ? "page" : undefined}
            className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2b6cf3] ${
              active ? "bg-white/10 text-white" : "text-white/70 hover:bg-white/5 hover:text-white"
            }`}
          >
            <item.icon className="h-4 w-4 shrink-0" />
            {item.label}
          </Link>
        );
      })}
      <div className="mt-auto">
        <button
          type="button"
          onClick={handleSignOut}
          className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-white/70 transition hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2b6cf3]"
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </button>
      </div>
    </nav>
  );

  return (
    <div className={`min-h-screen ${PAGE_BG}`}>
      {/* Fixed, matching the chat header — see routes/index.tsx */}
      <header
        className="fixed inset-x-0 top-0 z-40 h-[72px] border-b border-white/10 backdrop-blur-xl"
        style={{ background: HEADER_GRADIENT, boxShadow: "0 8px 24px -12px rgba(21,36,61,0.4)" }}
      >
        <div className="flex h-full items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="text-white hover:bg-white/10 lg:hidden"
              aria-label={mobileOpen ? "Close menu" : "Open menu"}
              aria-expanded={mobileOpen}
              onClick={() => setMobileOpen((v) => !v)}
            >
              {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </Button>
            <div
              className="flex h-10 w-10 items-center justify-center rounded-xl text-lg font-black text-white shadow-lg"
              style={{ background: TILE_GRADIENT }}
            >
              D
            </div>
            <div className="leading-tight">
              <div className="text-[15px] font-semibold tracking-tight text-white">
                Ask the Digit
              </div>
              <div className="text-[11px] text-white/60">Admin Console</div>
            </div>
          </div>
          <Link
            to="/"
            className="rounded-full bg-white px-3 py-2 text-xs font-semibold text-[#15243D] shadow-md transition hover:shadow-lg sm:px-4 sm:text-sm"
          >
            Open chat
          </Link>
        </div>
      </header>

      {/* Desktop sidebar */}
      <aside
        className="fixed bottom-0 left-0 top-[72px] hidden w-60 border-r border-white/10 lg:block"
        style={{ background: BRAND }}
      >
        {sidebar}
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <>
          <div
            className="fixed inset-0 top-[72px] z-30 bg-black/40 lg:hidden"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />
          <aside
            className="fixed bottom-0 left-0 top-[72px] z-30 w-60 border-r border-white/10 lg:hidden"
            style={{ background: BRAND }}
          >
            {sidebar}
          </aside>
        </>
      )}

      <main className="px-4 pb-16 pt-[88px] sm:px-6 lg:pl-[264px]">
        <Outlet />
      </main>
    </div>
  );
}
