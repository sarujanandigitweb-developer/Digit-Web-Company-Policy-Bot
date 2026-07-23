/**
 * The permission matrix — the only place a role's abilities are declared.
 *
 * This lives in TypeScript rather than a `roles` table on purpose: the roles are
 * fixed, and here the compiler rejects a typo'd permission at build time while a
 * database row could not. Guards and UI both read from this, so a capability is
 * never re-described in two places.
 */

export type Role = "super_admin" | "admin" | "team_leader";

export const PERMISSIONS = [
  "users.create_admin",
  "users.create_team_leader",
  "users.edit",
  "users.delete",
  "users.assign_role",
  "users.reset_password",
  "analytics.view",
  "knowledge.manage",
  "knowledge.update_department_docs",
  "knowledge.view_own_department",
  "gaps.view",
  "gaps.review",
  "providers.manage",
  "chat.use",
  "feedback.submit",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

// Team leaders run the knowledge base for the console: knowledge, gaps, analytics,
// conversations and departments — every admin page except Users and Settings.
const TEAM_LEADER: Permission[] = [
  "chat.use",
  "feedback.submit",
  "knowledge.view_own_department",
  "knowledge.manage",
  "knowledge.update_department_docs",
  "analytics.view",
  "gaps.view",
  "gaps.review",
];

// Admins do everything team leaders do, plus manage users.
const ADMIN: Permission[] = [...TEAM_LEADER, "users.create_team_leader", "users.edit"];

// Super admins add the destructive and structural powers: creating other admins,
// deleting users, reassigning roles, and configuring AI providers.
const SUPER_ADMIN: Permission[] = [
  ...ADMIN,
  "users.create_admin",
  "users.delete",
  "users.assign_role",
  "users.reset_password",
  "providers.manage",
];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  team_leader: TEAM_LEADER,
  admin: ADMIN,
  super_admin: SUPER_ADMIN,
};

export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

/**
 * Whether a role sees every department's knowledge, or only its own.
 *
 * Team leaders are scoped to their own department: on the console's Knowledge,
 * Search and stats surfaces they only ever see, edit or delete documents in the
 * department they lead. Admins and super admins see every department.
 */
export function hasGlobalKnowledgeAccess(role: Role): boolean {
  return role === "admin" || role === "super_admin";
}

/** Roles a given role is allowed to assign. Only super admins can mint admins. */
export function assignableRoles(role: Role): Role[] {
  if (role === "super_admin") return ["super_admin", "admin", "team_leader"];
  if (role === "admin") return ["team_leader"];
  return [];
}
