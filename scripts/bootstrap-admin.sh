#!/usr/bin/env bash
# Creates the first super admin.
#
# Chicken-and-egg: POST /api/admin/users requires an existing super admin, so the
# very first one cannot be made through the API. This registers the identity with
# Neon Auth and inserts the profile directly — the only place that is legitimate.
#
#   ./scripts/bootstrap-admin.sh you@company.com 'YourPassword123' 'Your Name'
set -euo pipefail
cd "$(dirname "$0")/.."

EMAIL="${1:-}"; PASSWORD="${2:-}"; NAME="${3:-Super Admin}"
if [ -z "$EMAIL" ] || [ -z "$PASSWORD" ]; then
  echo "usage: $0 <email> <password> [full name]" >&2; exit 1
fi

set -a; . ./.env; set +a
: "${NEON_AUTH_URL:?NEON_AUTH_URL missing from .env}"
: "${DATABASE_URL_UNPOOLED:?DATABASE_URL_UNPOOLED missing from .env}"

# Neon Auth checks Origin against trusted_origins; localhost is allowed by default.
ORIGIN="${APP_ORIGIN:-http://localhost:8080}"

echo "→ registering $EMAIL with Neon Auth"
RESPONSE=$(curl -s -X POST "$NEON_AUTH_URL/sign-up/email" \
  -H 'Content-Type: application/json' -H "Origin: $ORIGIN" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\",\"name\":\"$NAME\"}")

USER_ID=$(printf '%s' "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('user',{}).get('id',''))" 2>/dev/null || true)

if [ -z "$USER_ID" ]; then
  # Already registered is fine — adopt the existing identity and give it a profile.
  USER_ID=$(psql "$DATABASE_URL_UNPOOLED" -tAc \
    "select id from neon_auth.\"user\" where email='$EMAIL';" | tr -d ' ')
  if [ -z "$USER_ID" ]; then
    echo "✗ sign-up failed: $RESPONSE" >&2; exit 1
  fi
  echo "→ identity already existed, reusing it"
fi

psql "$DATABASE_URL_UNPOOLED" -qtAc "
  INSERT INTO profiles (user_id, full_name, role, status)
  VALUES ('$USER_ID', '$NAME', 'super_admin', 'active')
  ON CONFLICT (user_id) DO UPDATE SET role='super_admin', status='active';" >/dev/null

echo "✓ super admin ready"
echo "  email:   $EMAIL"
echo "  user_id: $USER_ID"
echo
echo "Get a token with:  ./scripts/token.sh $EMAIL '$PASSWORD'"
