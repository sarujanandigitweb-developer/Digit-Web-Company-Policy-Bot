/**
 * Browser-side auth against the hosted Neon Auth service.
 *
 * Deliberately not the @neondatabase/auth SDK: it is beta and ships its own UI
 * kit, which would mean a second design system in a project that already has
 * one. This talks to the same REST endpoints the server already trusts.
 *
 * Flow: sign-in sets a session cookie on the Neon Auth domain (SameSite=None,
 * Partitioned — issued for cross-site use), then /token exchanges it for a JWT.
 * The JWT is what our own API verifies, so no cookie is ever shared between the
 * two origins.
 */

const AUTH_URL = (import.meta.env.VITE_NEON_AUTH_URL as string | undefined)?.replace(/\/$/, "");

export class AuthError extends Error {}

function baseUrl(): string {
  if (!AUTH_URL) throw new AuthError("VITE_NEON_AUTH_URL is not configured");
  return AUTH_URL;
}

/** credentials:'include' is required — the session cookie is cross-site. */
async function authFetch(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${baseUrl()}${path}`, {
    ...init,
    credentials: "include",
    headers: { "content-type": "application/json", ...init.headers },
  });
}

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
}

/**
 * Cached JWT. Tokens live ~15 minutes; we refresh a minute early so a request
 * cannot lose a race with expiry mid-flight.
 */
let cached: { token: string; expiresAt: number } | null = null;
let inflight: Promise<string | null> | null = null;

const REFRESH_MARGIN_MS = 60_000;

function decodeExpiry(token: string): number {
  try {
    const payload = JSON.parse(atob(token.split(".")[1])) as { exp?: number };
    return payload.exp ? payload.exp * 1000 : Date.now() + 10 * 60_000;
  } catch {
    return Date.now() + 10 * 60_000;
  }
}

/**
 * Returns a valid JWT, or null when signed out.
 * Concurrent callers share one refresh rather than stampeding /token.
 */
export async function getToken(): Promise<string | null> {
  if (cached && cached.expiresAt - REFRESH_MARGIN_MS > Date.now()) return cached.token;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const response = await authFetch("/token");
      if (!response.ok) {
        cached = null;
        return null;
      }
      const body = (await response.json()) as { token?: string };
      if (!body.token) {
        cached = null;
        return null;
      }
      cached = { token: body.token, expiresAt: decodeExpiry(body.token) };
      return body.token;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

export async function signIn(email: string, password: string): Promise<AuthUser> {
  const response = await authFetch("/sign-in/email", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  const body = (await response.json().catch(() => ({}))) as {
    user?: AuthUser;
    message?: string;
    code?: string;
  };

  if (!response.ok || !body.user) {
    // Neon Auth distinguishes these; the user should not learn which addresses
    // exist, so both surface as the same message.
    throw new AuthError(
      body.code === "INVALID_EMAIL_OR_PASSWORD" || response.status === 401
        ? "Incorrect email or password"
        : (body.message ?? "Could not sign in"),
    );
  }

  cached = null; // force a fresh token for the new session
  return body.user;
}

export async function signOut(): Promise<void> {
  cached = null;
  await authFetch("/sign-out", { method: "POST" }).catch(() => {});
}

/** The signed-in user, or null. Used by the route guard. */
export async function getSession(): Promise<AuthUser | null> {
  const response = await authFetch("/get-session").catch(() => null);
  if (!response?.ok) return null;
  const body = (await response.json().catch(() => null)) as { user?: AuthUser } | null;
  return body?.user ?? null;
}
