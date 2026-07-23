import { AppError, Conflict } from "@/lib/http/errors";
import { sql } from "@/lib/db/client.server";

/**
 * Server-side client for the hosted Neon Auth service.
 *
 * Identity lives in Neon Auth, not in our tables, so creating a user is an HTTP
 * call to another service and cannot join a Postgres transaction. Callers must
 * therefore compensate on failure — see users.service.create.
 *
 * Neon Auth validates the Origin header against the project's trusted_origins
 * (localhost is allowed separately), which is why every call forwards the origin
 * of the admin request that triggered it.
 */

function authBaseUrl(): string {
  const url = process.env.NEON_AUTH_URL;
  if (!url) throw new Error("NEON_AUTH_URL is not set");
  return url.replace(/\/$/, "");
}

/** The origin to present to Neon Auth: that of the incoming admin request. */
export function originOf(request: Request): string {
  return request.headers.get("origin") ?? new URL(request.url).origin;
}

interface SignUpResponse {
  user?: { id: string; email: string };
  code?: string;
  message?: string;
}

/**
 * Creates an identity in Neon Auth and returns its id.
 *
 * Uses the sign-up endpoint because it is the only server-reachable way to
 * register email/password credentials: Better Auth owns password hashing, so we
 * cannot write neon_auth.account ourselves. The session it returns is discarded —
 * an admin creating an account must not be logged in as that account.
 */
export async function createAuthUser(input: {
  email: string;
  password: string;
  fullName: string;
  origin: string;
}): Promise<{ id: string }> {
  let response: Response;
  try {
    response = await fetch(`${authBaseUrl()}/sign-up/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: input.origin },
      body: JSON.stringify({
        email: input.email,
        password: input.password,
        name: input.fullName,
      }),
    });
  } catch (cause) {
    throw new AppError(502, "auth_unreachable", "Could not reach the authentication service", {
      cause: String(cause),
    });
  }

  const body = (await response.json().catch(() => ({}))) as SignUpResponse;

  if (!response.ok) {
    // Neon Auth reports an existing address as USER_ALREADY_EXISTS; surface it as
    // a 409 naming the field rather than a generic auth failure.
    if (
      body.code === "USER_ALREADY_EXISTS" ||
      /already exists|already registered/i.test(body.message ?? "")
    ) {
      throw Conflict(`A user with email "${input.email}" already exists`);
    }
    if (response.status === 403) {
      throw new AppError(
        502,
        "auth_origin_rejected",
        `Neon Auth rejected origin "${input.origin}". Add this domain to trusted_origins.`,
      );
    }
    throw new AppError(502, "auth_error", body.message ?? "Authentication service error");
  }

  if (!body.user?.id) {
    throw new AppError(502, "auth_error", "Authentication service returned no user id");
  }
  return { id: body.user.id };
}

/**
 * Resetting a password server-side.
 *
 * A user who has forgotten their password is signed out, so there is no session
 * to authorise the change. Better Auth's admin plugin can set any user's
 * password, but only for a caller whose Neon Auth account has role='admin'. We
 * therefore keep a dedicated service account (AUTH_ADMIN_EMAIL/PASSWORD, granted
 * that role by scripts/setup-auth-service.sh) and act as it here.
 *
 * This is powerful — it can rewrite anyone's password — so it lives behind the
 * one-time-code flow in password-reset.service and is never exposed to a route
 * directly. The service session cookie is cached and reused across resets; a
 * 401/403 (expired session) triggers exactly one re-sign-in.
 */

let serviceCookie: string | null = null;

function serviceCreds(): { email: string; password: string } {
  const email = process.env.AUTH_ADMIN_EMAIL;
  const password = process.env.AUTH_ADMIN_PASSWORD;
  if (!email || !password) {
    throw new AppError(
      500,
      "reset_not_configured",
      "Password reset is not configured: run scripts/setup-auth-service.sh",
    );
  }
  return { email, password };
}

/** Signs in as the service account and caches its session cookie. */
async function signInService(origin: string): Promise<string> {
  const { email, password } = serviceCreds();
  const response = await fetch(`${authBaseUrl()}/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({ email, password }),
  }).catch((cause) => {
    throw new AppError(502, "auth_unreachable", "Could not reach the authentication service", {
      cause: String(cause),
    });
  });
  if (!response.ok) {
    throw new AppError(502, "auth_error", "Password reset service account could not sign in");
  }
  // Re-send every cookie the service issued (session token + any csrf marker).
  const cookies = response.headers.getSetCookie().map((c) => c.split(";")[0]);
  if (cookies.length === 0) {
    throw new AppError(502, "auth_error", "Auth service returned no session for the reset account");
  }
  serviceCookie = cookies.join("; ");
  return serviceCookie;
}

/** The target user's Neon Auth id, or null if no such account exists. */
export async function findAuthUserIdByEmail(email: string): Promise<string | null> {
  const rows = (await sql`
    SELECT id FROM neon_auth."user" WHERE lower(email) = lower(${email}) LIMIT 1
  `) as Array<{ id: string }>;
  return rows[0]?.id ?? null;
}

/**
 * Sets `userId`'s password via the Better Auth admin API, acting as the service
 * account. Retries once with a fresh sign-in if the cached session is rejected.
 */
export async function adminSetPassword(input: {
  userId: string;
  newPassword: string;
  origin: string;
}): Promise<void> {
  const attempt = async (cookie: string): Promise<Response> =>
    fetch(`${authBaseUrl()}/admin/set-user-password`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: input.origin, cookie },
      body: JSON.stringify({ userId: input.userId, newPassword: input.newPassword }),
    });

  let cookie = serviceCookie ?? (await signInService(input.origin));
  let response: Response;
  try {
    response = await attempt(cookie);
    if (response.status === 401 || response.status === 403) {
      // Cached session expired or was revoked — sign in fresh and retry once.
      serviceCookie = null;
      cookie = await signInService(input.origin);
      response = await attempt(cookie);
    }
  } catch (cause) {
    throw new AppError(502, "auth_unreachable", "Could not reach the authentication service", {
      cause: String(cause),
    });
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { message?: string; code?: string };
    if (response.status === 403) {
      throw new AppError(
        500,
        "reset_not_authorized",
        "The reset service account lacks admin role. Re-run scripts/setup-auth-service.sh.",
      );
    }
    throw new AppError(502, "auth_error", body.message ?? "Could not set the new password");
  }
}
