#!/usr/bin/env bash
# Prints a JWT for calling the admin API. Tokens last ~15 minutes.
#
#   TOKEN=$(./scripts/token.sh you@company.com 'YourPassword123')
#   curl localhost:8080/api/admin/users -H "Authorization: Bearer $TOKEN"
set -euo pipefail
cd "$(dirname "$0")/.."

EMAIL="${1:-}"; PASSWORD="${2:-}"
if [ -z "$EMAIL" ] || [ -z "$PASSWORD" ]; then
  echo "usage: $0 <email> <password>" >&2; exit 1
fi

set -a; . ./.env; set +a
: "${NEON_AUTH_URL:?NEON_AUTH_URL missing from .env}"
ORIGIN="${APP_ORIGIN:-http://localhost:8080}"
JAR=$(mktemp)
trap 'rm -f "$JAR"' EXIT

# Sign in for a session cookie, then exchange it for a JWT. The server verifies
# the JWT against Neon's JWKS; the cookie itself never reaches our API.
curl -s -c "$JAR" -X POST "$NEON_AUTH_URL/sign-in/email" \
  -H 'Content-Type: application/json' -H "Origin: $ORIGIN" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" -o /dev/null

TOKEN=$(curl -s -b "$JAR" "$NEON_AUTH_URL/token" -H "Origin: $ORIGIN" \
  | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))" 2>/dev/null || true)

if [ -z "$TOKEN" ]; then
  echo "✗ could not get a token — check the email and password" >&2; exit 1
fi
printf '%s\n' "$TOKEN"
