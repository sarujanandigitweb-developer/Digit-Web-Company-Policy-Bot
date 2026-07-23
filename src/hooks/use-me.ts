import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api/client";

/** The signed-in user's identity and role, from /api/me. */
export interface Me {
  userId: string;
  email: string | null;
  fullName: string | null;
  role: "super_admin" | "admin" | "team_leader";
  departmentId: string | null;
  status: "active" | "suspended";
}

/**
 * The current user. Shares the ["me"] query key with the admin layout, so it
 * reuses that cache rather than making a second request. Pages use it to adapt
 * the UI to the caller's role — e.g. a team leader only manages their own
 * department, so choices the server would override are hidden.
 */
export function useMe() {
  return useQuery({ queryKey: ["me"], queryFn: () => api.get<Me>("/api/me") });
}
