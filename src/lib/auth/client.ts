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

/**
 * Signs in.
 *
 * `rememberMe` is honoured by Neon Auth, verified against the live service:
 * true issues a session cookie with Max-Age=604800 (persists 7 days), false
 * issues one with no Max-Age (dies with the browser) plus a `dont_remember`
 * marker. The checkbox is therefore a real control, not decoration.
 */
export async function signIn(
  email: string,
  password: string,
  rememberMe = true,
): Promise<AuthUser> {
  const response = await authFetch("/sign-in/email", {
    method: "POST",
    body: JSON.stringify({ email, password, rememberMe }),
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

/**
 * Starts a password reset.
 *
 * Neon Auth answers identically whether or not the address exists — it will not
 * confirm which emails are registered, and neither will we. Callers should show
 * the same confirmation regardless.
 */
export async function requestPasswordReset(email: string, redirectTo: string): Promise<void> {
  const response = await authFetch("/request-password-reset", {
    method: "POST",
    body: JSON.stringify({ email, redirectTo }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { message?: string };
    throw new AuthError(body.message ?? "Could not send the reset email");
  }
}

/**
 * Changes the signed-in user's password.
 *
 * Neon Auth (Better Auth) verifies `currentPassword` server-side before setting
 * the new one and rejects a wrong current password with a 400 — we never check
 * the old password ourselves, so there is nothing to get out of sync. The session
 * cookie identifies who is changing it; no id is sent.
 */
export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  const response = await authFetch("/change-password", {
    method: "POST",
    body: JSON.stringify({ currentPassword, newPassword, revokeOtherSessions: false }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { message?: string; code?: string };
    // A wrong current password is the common case and deserves its own wording;
    // anything else surfaces the service's message.
    const wrongCurrent = body.code === "INVALID_PASSWORD" || body.code === "INCORRECT_PASSWORD";
    throw new AuthError(
      wrongCurrent
        ? "Your current password is incorrect"
        : (body.message ?? "Could not change your password"),
    );
  }
}

/**
 * Password reset by one-time code — served by our own API, not Neon Auth.
 *
 * Neon Auth generates an OTP but never delivers the email and won't hand us the
 * code, so /api/auth/reset/* owns the whole path: it generates the code, emails
 * it over SMTP, stores it hashed with an expiry, rate-limits and locks it, spends
 * it once, and writes the new password through the Better Auth admin API. These
 * endpoints are same-origin and public (the user is signed out), so they use a
 * plain fetch rather than the Bearer-authenticated api client.
 */

/**
 * Kept for backwards compatibility with callers that still catch it. The
 * self-hosted flow no longer needs a feature-detection error, so it is never
 * thrown — but removing the export would break existing imports.
 */
export class OtpUnavailableError extends AuthError {}

/** Reads the server's { error: { message } } envelope, falling back to a default. */
async function resetErrorMessage(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as {
    error?: { message?: string };
  } | null;
  return body?.error?.message ?? fallback;
}

/**
 * Step 1 — ask our API to email a reset code.
 *
 * The endpoint always answers 200 { sent: true } for any well-formed email so it
 * can't be used to discover which addresses exist; only a real server fault (5xx)
 * or an unreachable server is surfaced.
 */
export async function sendResetOtp(email: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch("/api/auth/reset/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    });
  } catch {
    throw new AuthError("Could not reach the server. Please try again.");
  }
  if (response.ok) return;
  // 400 here means email is not configured on the server — a real, surfaced fault.
  throw new AuthError(await resetErrorMessage(response, "Could not send the code right now."));
}

export type OtpCheck = "valid" | "invalid" | "unsupported";

/**
 * Step 2 — check a code without spending it, so the Verify page can validate
 * before the user picks a new password.
 */
export async function checkResetOtp(email: string, otp: string): Promise<OtpCheck> {
  let response: Response;
  try {
    response = await fetch("/api/auth/reset/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, code: otp }),
    });
  } catch {
    throw new AuthError("Could not reach the server. Please try again.");
  }
  if (response.status >= 500) {
    throw new AuthError("Could not verify the code right now. Please try again shortly.");
  }
  const body = (await response.json().catch(() => ({}))) as { valid?: boolean };
  return body.valid ? "valid" : "invalid";
}

/**
 * Step 3 — set the new password, spending the code. A wrong or expired code, or
 * a password the server rejects, fails here.
 */
export async function resetPasswordWithOtp(
  email: string,
  otp: string,
  newPassword: string,
): Promise<void> {
  let response: Response;
  try {
    response = await fetch("/api/auth/reset/confirm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, code: otp, password: newPassword }),
    });
  } catch {
    throw new AuthError("Could not reach the server. Please try again.");
  }
  if (response.ok) return;
  throw new AuthError(
    await resetErrorMessage(response, "Could not reset your password. Please try again."),
  );
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
