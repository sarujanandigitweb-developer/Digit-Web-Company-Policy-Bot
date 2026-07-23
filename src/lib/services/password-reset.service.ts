import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { sql } from "@/lib/db/client.server";
import { adminSetPassword, findAuthUserIdByEmail } from "@/lib/auth/neon-auth.server";
import { emailConfigured, sendResetCode } from "@/lib/email/mailer.server";
import { BadRequest } from "@/lib/http/errors";

/**
 * Self-hosted password reset by one-time code.
 *
 * Neon Auth generates its own OTP but never delivers the email and won't hand us
 * the code, so we own the whole path: generate a 6-digit code, email it, store
 * only its hash with an expiry, verify it here, then write the new password
 * through the Better Auth admin API (see neon-auth.server.adminSetPassword).
 *
 * Two rules run through every step:
 *  - No enumeration: an unknown address behaves exactly like a known one. We
 *    never tell the caller whether an email is registered.
 *  - The code is a secret: it is emailed once and stored only as a SHA-256 hash,
 *    compared in constant time, spent once, and locked after a few wrong tries.
 */

const CODE_TTL_MINUTES = Number(process.env.PASSWORD_RESET_TTL_MINUTES ?? 10);
const MAX_PER_HOUR = Number(process.env.PASSWORD_RESET_MAX_PER_HOUR ?? 5);
const RESEND_COOLDOWN_SECONDS = 60;
const MAX_ATTEMPTS = 5;
const MIN_PASSWORD = 8;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

function hashesEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** A cryptographically-random, uniformly-distributed 6-digit code. */
function generateCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/**
 * Step 1 — email a reset code, if the address has an account.
 *
 * Always resolves to the same "sent" outcome from the caller's perspective:
 * unknown emails, cooldown, and hourly-cap all return silently so none of them
 * reveal whether the address exists or how often it has been tried.
 */
export async function requestReset(rawEmail: string): Promise<void> {
  const email = normalizeEmail(rawEmail);
  if (!email || !email.includes("@")) return; // malformed — nothing to leak

  if (!emailConfigured()) {
    // A real fault the user can't work around, and not tied to any address.
    throw BadRequest("Password reset email is not configured on the server.");
  }

  // Anti-abuse: recent-send cooldown and an hourly cap, both by email.
  const recent = (await sql`
    SELECT
      count(*) FILTER (WHERE created_at > now() - interval '1 hour')            AS last_hour,
      count(*) FILTER (WHERE created_at > now() - make_interval(secs => ${RESEND_COOLDOWN_SECONDS})) AS last_minute
    FROM password_reset_codes
    WHERE email = ${email}
  `) as Array<{ last_hour: number; last_minute: number }>;
  if (Number(recent[0]?.last_minute ?? 0) > 0) return; // still in cooldown
  if (Number(recent[0]?.last_hour ?? 0) >= MAX_PER_HOUR) return; // hourly cap hit

  const userId = await findAuthUserIdByEmail(email);
  if (!userId) return; // unknown address — stay silent

  const code = generateCode();
  // Invalidate any still-live codes for this email, then store the new one.
  await sql`
    UPDATE password_reset_codes
    SET consumed_at = now()
    WHERE email = ${email} AND consumed_at IS NULL AND expires_at > now()
  `;
  await sql`
    INSERT INTO password_reset_codes (email, code_hash, expires_at)
    VALUES (${email}, ${hashCode(code)}, now() + make_interval(mins => ${CODE_TTL_MINUTES}))
  `;

  await sendResetCode(email, code, CODE_TTL_MINUTES);
}

type CodeRow = {
  id: string;
  code_hash: string;
  attempts: number;
};

/** The newest live (unexpired, unconsumed) code for an email, or null. */
async function liveCode(email: string): Promise<CodeRow | null> {
  const rows = (await sql`
    SELECT id, code_hash, attempts
    FROM password_reset_codes
    WHERE email = ${email} AND consumed_at IS NULL AND expires_at > now()
    ORDER BY created_at DESC
    LIMIT 1
  `) as CodeRow[];
  return rows[0] ?? null;
}

export type VerifyResult = "valid" | "invalid";

/**
 * Step 2 — check a code without spending it, so the Verify screen can validate
 * before the user picks a new password. A wrong guess counts toward the lockout;
 * once the cap is hit the code is burned so brute force can't continue.
 */
export async function verifyCode(rawEmail: string, code: string): Promise<VerifyResult> {
  const email = normalizeEmail(rawEmail);
  const row = await liveCode(email);
  if (!row) return "invalid";

  if (hashesEqual(row.code_hash, hashCode(code))) return "valid";

  const attempts = row.attempts + 1;
  if (attempts >= MAX_ATTEMPTS) {
    await sql`UPDATE password_reset_codes SET consumed_at = now(), attempts = ${attempts} WHERE id = ${row.id}`;
  } else {
    await sql`UPDATE password_reset_codes SET attempts = ${attempts} WHERE id = ${row.id}`;
  }
  return "invalid";
}

/**
 * Step 3 — spend the code and set the new password.
 *
 * The code is consumed first (marked spent) so a replay can't reuse it even if
 * the password write later fails; then the password is written through the admin
 * API. A wrong/expired code, or a weak new password, is rejected here.
 */
export async function resetPassword(
  rawEmail: string,
  code: string,
  newPassword: string,
  origin: string,
): Promise<void> {
  if (newPassword.length < MIN_PASSWORD) {
    throw BadRequest(`Password must be at least ${MIN_PASSWORD} characters.`);
  }
  const email = normalizeEmail(rawEmail);
  const row = await liveCode(email);
  if (!row || !hashesEqual(row.code_hash, hashCode(code))) {
    throw BadRequest("That code is invalid or has expired. Request a new one and try again.");
  }

  // Spend the code up front: even if the write below fails, it can't be replayed.
  await sql`UPDATE password_reset_codes SET consumed_at = now() WHERE id = ${row.id}`;

  const userId = await findAuthUserIdByEmail(email);
  if (!userId) {
    // The account vanished between request and reset — treat as an invalid code.
    throw BadRequest("That code is invalid or has expired. Request a new one and try again.");
  }
  await adminSetPassword({ userId, newPassword, origin });
}
