import { SignJWT, importPKCS8 } from "jose";

/**
 * Google service-account authentication, using `jose` (already a dependency
 * for Neon Auth's JWKS verification) rather than adding the `googleapis` SDK.
 *
 * A service account is optional for this feature. Without one:
 *   - a Google Doc / Drive file that is link-shared can still be fetched via
 *     its public export/download URL (see google-drive.server.ts) — that is
 *     unauthenticated and works today.
 *   - a Drive FOLDER cannot be listed at all: Drive's API rejects even an API
 *     key for files.list ("API keys are not supported by this API"), and
 *     there is no unauthenticated folder-listing endpoint. Verified live.
 *
 * With a service account (GOOGLE_SA_CLIENT_EMAIL + GOOGLE_SA_PRIVATE_KEY set):
 *   - folders can be listed (files.list)
 *   - private files can be read (files.get / files.export)
 *   - Drive's modifiedTime becomes available, which is what the cache uses to
 *     invalidate itself precisely instead of on a fixed TTL.
 *
 * Read-only scopes only — this account can never write to Drive or Sheets.
 */

const SCOPES = "https://www.googleapis.com/auth/drive.readonly";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

export function isServiceAccountConfigured(): boolean {
  return !!(process.env.GOOGLE_SA_CLIENT_EMAIL && process.env.GOOGLE_SA_PRIVATE_KEY);
}

interface CachedToken {
  token: string;
  expiresAt: number;
}
// Module-scoped, like transcript.server.ts's cache: cheap, and wrong only in
// the sense that a cold serverless instance re-mints a token — never wrong in
// the sense of serving a stale one, since expiry is checked every call.
let cached: CachedToken | null = null;
let tokenRequest: Promise<string> | null = null;

/**
 * A short-lived OAuth2 access token for the service account, or null when no
 * service account is configured. Signs a JWT assertion with the account's own
 * private key (RFC 7523) and exchanges it — the standard server-to-server
 * flow, with no user consent screen and no refresh token to manage.
 */
export async function getDriveAccessToken(): Promise<string | null> {
  if (!isServiceAccountConfigured()) return null;
  if (cached && cached.expiresAt > Date.now() + 30_000) return cached.token;

  if (tokenRequest) return tokenRequest;
  tokenRequest = mintDriveAccessToken();
  try {
    return await tokenRequest;
  } finally {
    tokenRequest = null;
  }
}

async function mintDriveAccessToken(): Promise<string> {
  const clientEmail = process.env.GOOGLE_SA_CLIENT_EMAIL!;
  // Vercel env vars store literal "\n" for newlines inside a PEM key; restore
  // real line breaks before handing it to the PKCS8 parser.
  const privateKey = process.env.GOOGLE_SA_PRIVATE_KEY!.replace(/\\n/g, "\n");

  const key = await importPKCS8(privateKey, "RS256");
  const now = Math.floor(Date.now() / 1000);
  const assertion = await new SignJWT({ scope: SCOPES })
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(clientEmail)
    .setAudience(TOKEN_URL)
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(key);

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!response.ok) {
    throw new Error(
      `Google token exchange failed (HTTP ${response.status}): ${await response.text()}`,
    );
  }
  const body = (await response.json()) as { access_token: string; expires_in: number };
  cached = { token: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
  return cached.token;
}
