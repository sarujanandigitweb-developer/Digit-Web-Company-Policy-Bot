import { AppError, Conflict } from "@/lib/http/errors";

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
