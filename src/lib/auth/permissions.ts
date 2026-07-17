/**
 * The permission matrix — the only place a role's abilities are declared.
 *
 * This lives in TypeScript rather than a `roles` table on purpose: the roles are
 * fixed, and here the compiler rejects a typo'd permission at build time while a
 * database row could not. Guards and UI both read from this, so a capability is
 * never re-described in two places.
 */

export type Role = "super_admin" | "admin" | "staff";

export const PERMISSIONS = [
  "users.create_admin",
  "users.create_staff",
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

const STAFF: Permission[] = ["chat.use", "knowledge.view_own_department", "feedback.submit"];

// Admins do everything staff do, plus manage staff, knowledge, gaps and analytics.
const ADMIN: Permission[] = [
  ...STAFF,
  "users.create_staff",
  "users.edit",
  "knowledge.manage",
  "knowledge.update_department_docs",
  "analytics.view",
  "gaps.view",
  "gaps.review",
];

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
  staff: STAFF,
  admin: ADMIN,
  super_admin: SUPER_ADMIN,
};

export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

/**
 * Whether a role sees every department's knowledge, or only its own.
 * Management (admin and super admin) is deliberately not scoped to a department.
 */
export function hasGlobalKnowledgeAccess(role: Role): boolean {
  return role === "admin" || role === "super_admin";
}

/** Roles a given role is allowed to assign. Staff and admins cannot mint admins. */
export function assignableRoles(role: Role): Role[] {
  if (role === "super_admin") return ["super_admin", "admin", "staff"];
  if (role === "admin") return ["staff"];
  return [];
}
