#!/usr/bin/env bash
#
# One-time setup for the password-reset service account.
#
# Creates a dedicated Neon Auth user, grants it Better Auth `admin` role (so it
# can call /admin/set-user-password), and appends its generated password to .env
# as AUTH_ADMIN_PASSWORD. The generated password is never printed.
#
# Idempotent: if the account already exists it is deleted and recreated, since
# Better Auth owns the password hash and we cannot recover the old one.
#
# Usage:  bash scripts/setup-auth-service.sh
set -euo pipefail

cd "$(dirname "$0")/.."

# --- load config from .env ---
get() { grep -E "^$1=" .env | head -1 | cut -d= -f2- | sed -E 's/^"(.*)"$/\1/'; }
NEON_AUTH_URL="$(get NEON_AUTH_URL)"
DB="$(get DATABASE_URL_UNPOOLED)"
SVC_EMAIL="$(get AUTH_ADMIN_EMAIL)"

[ -n "$NEON_AUTH_URL" ] || { echo "NEON_AUTH_URL missing in .env" >&2; exit 1; }
[ -n "$DB" ]           || { echo "DATABASE_URL_UNPOOLED missing in .env" >&2; exit 1; }
[ -n "$SVC_EMAIL" ]    || { echo "AUTH_ADMIN_EMAIL missing in .env" >&2; exit 1; }

echo "Service account: $SVC_EMAIL"

# --- strong random password (never printed) ---
SVC_PASS="Svc-$(openssl rand -base64 24 | tr -dc 'A-Za-z0-9')-Aa1"

# --- remove any prior instance so sign-up succeeds with a known password ---
psql "$DB" -v ON_ERROR_STOP=1 -q \
  -c "DELETE FROM neon_auth.\"user\" WHERE email = '$SVC_EMAIL';"

# --- create the account ---
code=$(curl -s -o /tmp/svc_signup.json -w "%{http_code}" \
  -X POST "$NEON_AUTH_URL/sign-up/email" \
  -H "content-type: application/json" -H "origin: http://localhost:3000" \
  --data-binary "$(printf '{"email":"%s","password":"%s","name":"Password Reset Service"}' "$SVC_EMAIL" "$SVC_PASS")")
if [ "$code" != "200" ]; then
  echo "Sign-up failed (HTTP $code):" >&2; cat /tmp/svc_signup.json >&2; echo >&2; exit 1
fi

# --- grant Better Auth admin role ---
psql "$DB" -v ON_ERROR_STOP=1 -q \
  -c "UPDATE neon_auth.\"user\" SET role = 'admin' WHERE email = '$SVC_EMAIL';"

# --- persist the password to .env (replace if already present) ---
if grep -qE '^AUTH_ADMIN_PASSWORD=' .env; then
  tmp=$(mktemp)
  grep -vE '^AUTH_ADMIN_PASSWORD=' .env > "$tmp" && mv "$tmp" .env
fi
printf 'AUTH_ADMIN_PASSWORD=%s\n' "$SVC_PASS" >> .env

# --- verify the account can actually set a password ---
curl -s -c /tmp/svc_cookies.txt -o /dev/null \
  -X POST "$NEON_AUTH_URL/sign-in/email" \
  -H "content-type: application/json" -H "origin: http://localhost:3000" \
  --data-binary "$(printf '{"email":"%s","password":"%s"}' "$SVC_EMAIL" "$SVC_PASS")"

svc_id=$(psql "$DB" -tAq -c "SELECT id FROM neon_auth.\"user\" WHERE email = '$SVC_EMAIL';")
verify=$(curl -s -b /tmp/svc_cookies.txt -o /tmp/svc_verify.json -w "%{http_code}" \
  -X POST "$NEON_AUTH_URL/admin/set-user-password" \
  -H "content-type: application/json" -H "origin: http://localhost:3000" \
  --data-binary "$(printf '{"userId":"%s","newPassword":"%s"}' "$svc_id" "$SVC_PASS")")
rm -f /tmp/svc_signup.json /tmp/svc_cookies.txt /tmp/svc_verify.json

if [ "$verify" = "200" ]; then
  echo "OK: service account created, admin role granted, AUTH_ADMIN_PASSWORD written to .env."
else
  echo "WARNING: account created but admin set-password check returned HTTP $verify." >&2
  echo "The admin plugin may not be enabled for this project." >&2
  exit 1
fi
