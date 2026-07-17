import { createRemoteJWKSet, jwtVerify } from "jose";
import { sql } from "@/lib/db/client.server";
import { Forbidden, Unauthorized } from "@/lib/http/errors";
import type { Permission, Role } from "./permissions";
import { can } from "./permissions";

/**
 * Session handling for Neon Auth.
 *
 * Neon Auth runs as a hosted service on its own domain, and its server SDK ships
 * for Next.js only — neither helps a TanStack Start route. So the client obtains
 * a JWT (authClient.token()) and sends it as a Bearer token, and we verify it
 * here against Neon's published JWKS. That is cross-origin safe by construction:
 * no cookie ever has to be shared between the two domains.
 *
 * Tokens are EdDSA and expire in ~15 minutes; the client refreshes them.
 */

function authBaseUrl(): string {
  const url = process.env.NEON_AUTH_URL;
  if (!url) throw new Error("NEON_AUTH_URL is not set");
  return url.replace(/\/$/, "");
}

// createRemoteJWKSet caches keys and re-fetches on rotation, so this is created
// once per instance rather than per request.
let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;
function keyStore() {
  if (!jwks) jwks = createRemoteJWKSet(new URL(`${authBaseUrl()}/.well-known/jwks.json`));
  return jwks;
}

/** An authenticated caller: identity from Neon Auth, authorization from profiles. */
export interface SessionUser {
  userId: string;
  email: string | null;
  fullName: string | null;
  role: Role;
  departmentId: string | null;
  status: "active" | "suspended";
}

function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header?.toLowerCase().startsWith("bearer ")) return null;
  const token = header.slice(7).trim();
  return token.length > 0 ? token : null;
}

/**
 * Verifies the Bearer token and loads the caller's profile.
 * Returns null when unauthenticated — callers that require a user use requireAuth.
 */
export async function getSessionUser(request: Request): Promise<SessionUser | null> {
  const token = bearerToken(request);
  if (!token) return null;

  let subject: string;
  try {
    const { payload } = await jwtVerify(token, keyStore(), {
      issuer: new URL(authBaseUrl()).origin,
    });
    if (!payload.sub) return null;
    subject = payload.sub;
  } catch {
    // Expired, tampered, or signed by an unknown key — all indistinguishable
    // to the caller on purpose.
    return null;
  }

  // The JWT proves identity only. Role and department come from our own table,
  // so a revoked role takes effect on the next request rather than when the
  // token happens to expire.
  const rows = (await sql`
    SELECT p.user_id, p.full_name, p.role, p.department_id, p.status, u.email
    FROM profiles p
    JOIN neon_auth."user" u ON u.id = p.user_id
    WHERE p.user_id = ${subject}::uuid
    LIMIT 1
  `) as Array<{
    user_id: string;
    full_name: string | null;
    role: Role;
    department_id: string | null;
    status: "active" | "suspended";
    email: string | null;
  }>;

  const row = rows[0];
  if (!row) return null; // Authenticated with Neon Auth but has no profile yet.

  return {
    userId: row.user_id,
    email: row.email,
    fullName: row.full_name,
    role: row.role,
    departmentId: row.department_id,
    status: row.status,
  };
}

/**
 * Requires a valid session. Suspended accounts are rejected here so that every
 * guard below inherits the check and no route can forget it.
 */
export async function requireAuth(request: Request): Promise<SessionUser> {
  const user = await getSessionUser(request);
  if (!user) throw Unauthorized();
  if (user.status === "suspended") throw Forbidden("This account is suspended");
  return user;
}

/** Requires a specific capability. Prefer this over checking roles directly. */
export async function requirePermission(
  request: Request,
  permission: Permission,
): Promise<SessionUser> {
  const user = await requireAuth(request);
  if (!can(user.role, permission)) throw Forbidden();
  return user;
}

export async function requireRole(request: Request, roles: Role[]): Promise<SessionUser> {
  const user = await requireAuth(request);
  if (!roles.includes(user.role)) throw Forbidden();
  return user;
}

/** Any authenticated, active account. */
export const requireStaff = (request: Request) =>
  requireRole(request, ["staff", "admin", "super_admin"]);

/** Management side — admins and super admins, who see every department. */
export const requireAdmin = (request: Request) => requireRole(request, ["admin", "super_admin"]);

export const requireSuperAdmin = (request: Request) => requireRole(request, ["super_admin"]);
