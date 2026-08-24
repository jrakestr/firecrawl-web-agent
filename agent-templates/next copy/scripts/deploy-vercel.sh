#!/usr/bin/env bash
#
# One-shot Vercel setup + deploy for the MLB predictions board.
#
# Idempotent: safe to re-run. Creates the project if missing, overwrites env
# vars in place, deploys to production, then asserts the board serves real
# Supabase data instead of a 200 with an error body.
#
# Usage:
#   export VERCEL_TOKEN=...
#   export SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
#   export SUPABASE_SECRET_KEY=sb_secret_...
#   ./scripts/deploy-vercel.sh
#
# Optional overrides:
#   VERCEL_PROJECT_NAME   default: mlb-predictions
#   SUPABASE_URL          default: the Various Projects instance
#   FIRECRAWL_API_KEY     only needed for the /agent workspace, not the board

set -euo pipefail

cd "$(dirname "$0")/.."

PROJECT_NAME="${VERCEL_PROJECT_NAME:-mlb-predictions}"
SUPABASE_URL="${SUPABASE_URL:-https://gwvtpzjzrakggdbiwlyw.supabase.co}"
VERCEL="npx --yes vercel@latest"

fail() {
  echo "error: $*" >&2
  exit 1
}

require() {
  local name="$1"
  local value="${!name:-}"
  [ -n "$value" ] || fail "$name is not set. Add it as a Cloud Agent secret or export it before running."
}

require VERCEL_TOKEN

# Supabase keys are only needed the first time, or when rotating them. Without
# them we still deploy, reusing whatever the project already has configured.
PUSH_ENV=1
if [ -z "${SUPABASE_PUBLISHABLE_KEY:-}" ] || [ -z "${SUPABASE_SECRET_KEY:-}" ]; then
  PUSH_ENV=0
fi

echo "==> Authenticating"
$VERCEL whoami --token="$VERCEL_TOKEN" >/dev/null || fail "VERCEL_TOKEN rejected by Vercel."

# The anonymous link from a `deploy --temporary` run cannot hold project env
# vars, so drop it before linking to a real project.
if [ -f .vercel/anonymous.json ]; then
  echo "==> Removing anonymous deployment link"
  rm -rf .vercel
fi

echo "==> Linking project $PROJECT_NAME"
if ! $VERCEL link --yes --project "$PROJECT_NAME" --token="$VERCEL_TOKEN" 2>/dev/null; then
  echo "    project not found, creating it"
  $VERCEL project add "$PROJECT_NAME" --token="$VERCEL_TOKEN"
  $VERCEL link --yes --project "$PROJECT_NAME" --token="$VERCEL_TOKEN"
fi

# `vercel env add` takes the environment as a positional arg, and reads the
# value from stdin so secrets never land in argv or the shell history.
set_env() {
  local name="$1" value="$2" environment="$3"
  printf '%s' "$value" \
    | $VERCEL env add "$name" "$environment" --force --token="$VERCEL_TOKEN" >/dev/null
  echo "    $name -> $environment"
}

if [ "$PUSH_ENV" = 1 ]; then
  echo "==> Pushing environment variables"
  for environment in production preview development; do
    set_env SUPABASE_URL "$SUPABASE_URL" "$environment"
    set_env NEXT_PUBLIC_SUPABASE_URL "$SUPABASE_URL" "$environment"
    set_env SUPABASE_PUBLISHABLE_KEY "$SUPABASE_PUBLISHABLE_KEY" "$environment"
    set_env NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY "$SUPABASE_PUBLISHABLE_KEY" "$environment"
    set_env SUPABASE_SECRET_KEY "$SUPABASE_SECRET_KEY" "$environment"
    if [ -n "${FIRECRAWL_API_KEY:-}" ]; then
      set_env FIRECRAWL_API_KEY "$FIRECRAWL_API_KEY" "$environment"
    fi
  done
else
  echo "==> Skipping env push (Supabase keys not provided), reusing project config"
fi

echo "==> Building"
$VERCEL pull --yes --environment=production --token="$VERCEL_TOKEN"
$VERCEL build --prod --token="$VERCEL_TOKEN"

echo "==> Deploying to production"
DEPLOY_URL="$($VERCEL deploy --prebuilt --prod --token="$VERCEL_TOKEN")"
[ -n "$DEPLOY_URL" ] || fail "deploy produced no URL"

echo "==> Verifying $DEPLOY_URL"

api_body="$(curl -sS --max-time 60 "$DEPLOY_URL/api/predictions?limit=1")"
case "$api_body" in
  *'"error"'*)
    echo "$api_body" >&2
    fail "/api/predictions returned an error body. Check the env vars in the Vercel dashboard."
    ;;
esac
echo "    /api/predictions returned data"

root_status="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 30 "$DEPLOY_URL/")"
case "$root_status" in
  30*) echo "    / redirects to the board ($root_status)" ;;
  *) fail "/ returned $root_status, expected a redirect to /predictions" ;;
esac

board_html="$(curl -sSL --max-time 60 "$DEPLOY_URL/predictions")"
if ! grep -q 'Season Elo' <<<"$board_html"; then
  fail "/predictions is missing the Season Elo panel"
fi
if grep -q 'No games in the feed' <<<"$board_html"; then
  fail "/predictions rendered an empty board — Supabase returned no rows"
fi
echo "    /predictions renders the board with Elo"

echo
echo "Production URL: $DEPLOY_URL"
