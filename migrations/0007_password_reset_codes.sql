-- Self-hosted password-reset codes.
--
-- Neon Auth generates its own OTP but never delivers the email, and does not
-- return the code to us — so we own the code end to end: generate it, email it
-- via SMTP, verify it here, then write the new password through the Better Auth
-- admin API. This table is that store.
--
-- The code itself is never stored in the clear: only its SHA-256 hash, so a leak
-- of this table cannot be replayed against the reset endpoint.

CREATE TABLE IF NOT EXISTS password_reset_codes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Lowercased email. Not a FK: an unknown address must be indistinguishable
  -- from a known one (no enumeration), so we insert nothing for unknowns and
  -- never join this to neon_auth."user".
  email        text        NOT NULL,
  code_hash    text        NOT NULL,          -- SHA-256 of the 6-digit code
  expires_at   timestamptz NOT NULL,
  consumed_at  timestamptz,                   -- set once, when the reset succeeds
  attempts     smallint    NOT NULL DEFAULT 0, -- wrong guesses; locks the code at a cap
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- The verify/consume path looks codes up by email, newest first.
CREATE INDEX IF NOT EXISTS password_reset_codes_email_idx
  ON password_reset_codes (email, created_at DESC);
