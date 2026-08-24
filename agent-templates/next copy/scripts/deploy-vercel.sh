#!/usr/bin/env bash
#
# Vercel setup + deploy for the MLB predictions board.
#
# Two modes, picked automatically from what credentials are available:
#
#   VERCEL_TOKEN set      Permanent deploy. Creates/links a real project, pushes
#                         env vars to all three environments, deploys to prod.
#   VERCEL_TOKEN unset    Temporary deploy (expires in ~1h, claimable). Supabase
#                         values are passed inline on the deploy instead, since an
#                         anonymous deployment has no project to store them on.
#
# Idempotent: safe to re-run. Always verifies the board serves real Supabase
# rows rather than trusting a 200 status.
#
# Usage:
#   export SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
#   export SUPABASE_SECRET_KEY=sb_secret_...
#   export VERCEL_TOKEN=...            # optional, but required for a stable URL
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

have_supabase_keys() {
  [ -n "${SUPABASE_PUBLISHABLE_KEY:-}" ] && [ -n "${SUPABASE_SECRET_KEY:-}" ]
}

# Verify the deployment actually serves data. A 200 is not enough: the board
# renders fine while the API returns {"error":"SUPABASE_URL is required..."}.
verify() {
  local url="$1"
  echo "==> Verifying $url"

  local api_body
  api_body="$(curl -sS --max-time 60 "$url/api/predictions?limit=1")"
  case "$api_body" in
    *'is required but not set'*)
      echo "$api_body" >&2
      fail "env vars are not reaching the runtime."
      ;;
    *'Invalid API key'*)
      echo "$api_body" >&2
      fail "env vars arrived but a Supabase key is wrong. Re-copy them from the project API keys page."
      ;;
    *'"error"'*)
      echo "$api_body" >&2
      fail "/api/predictions returned an error body."
      ;;
  esac
  echo "    /api/predictions returned data"

  local root_status
  root_status="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 30 "$url/")"
  case "$root_status" in
    30*) echo "    / redirects to the board ($root_status)" ;;
    *) fail "/ returned $root_status, expected a redirect to /predictions" ;;
  esac

  local board_html
  board_html="$(curl -sSL --max-time 60 "$url/predictions")"
  if ! grep -q 'Season Elo' <<<"$board_html"; then
    fail "/predictions is missing the Season Elo panel"
  fi
  if grep -q 'No games in the feed' <<<"$board_html"; then
    fail "/predictions rendered an empty board — Supabase returned no rows"
  fi
  echo "    /predictions renders the board with Elo"
}

deploy_temporary() {
  have_supabase_keys \
    || fail "Need either VERCEL_TOKEN, or both SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY."

  echo "==> No VERCEL_TOKEN: deploying anonymously with inline env vars"
  echo "    (URL expires in ~1h; set VERCEL_TOKEN for a permanent one)"

  # -e is runtime env, -b is build-time. NEXT_PUBLIC_* must exist at build time
  # to be inlined, so pass both.
  local args=(
    -e "SUPABASE_URL=$SUPABASE_URL"
    -e "SUPABASE_PUBLISHABLE_KEY=$SUPABASE_PUBLISHABLE_KEY"
    -e "SUPABASE_SECRET_KEY=$SUPABASE_SECRET_KEY"
    -b "NEXT_PUBLIC_SUPABASE_URL=$SUPABASE_URL"
    -b "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$SUPABASE_PUBLISHABLE_KEY"
  )
  if [ -n "${FIRECRAWL_API_KEY:-}" ]; then
    args+=(-e "FIRECRAWL_API_KEY=$FIRECRAWL_API_KEY")
  fi

  rm -rf .vercel

  local url
  url="$($VERCEL deploy --yes --temporary --force "${args[@]}" \
    | grep -oE 'https://[a-z0-9-]+\.vercel\.app' | tail -1)"
  [ -n "$url" ] || fail "deploy produced no URL"

  verify "$url"
  echo
  echo "Temporary URL: $url"
  echo "Claim it in the Vercel dashboard to keep it, or rerun with VERCEL_TOKEN."
}

deploy_permanent() {
  echo "==> Authenticating"
  $VERCEL whoami --token="$VERCEL_TOKEN" >/dev/null \
    || fail "VERCEL_TOKEN rejected by Vercel."

  # An anonymous link from a previous --temporary run cannot hold project env
  # vars, so drop it before linking to a real project.
  if [ -f .vercel/anonymous.json ]; then
    echo "==> Removing anonymous deployment link"
    rm -rf .vercel
  fi

  echo "==> Linking project $PROJECT_NAME"
  if ! $VERCEL link --yes --project "$PROJECT_NAME" --token="$VERCEL_TOKEN"; then
    echo "    link failed, creating the project first"
    $VERCEL project add "$PROJECT_NAME" --token="$VERCEL_TOKEN"
    $VERCEL link --yes --project "$PROJECT_NAME" --token="$VERCEL_TOKEN"
  fi

  # `vercel env add` takes the environment as a positional arg, and reads the
  # value from stdin so secrets never land in argv.
  set_env() {
    local name="$1" value="$2" environment="$3"
    printf '%s' "$value" \
      | $VERCEL env add "$name" "$environment" --force --token="$VERCEL_TOKEN" >/dev/null
    echo "    $name -> $environment"
  }

  if have_supabase_keys; then
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
    echo "==> Supabase keys not provided, reusing existing project config"
  fi

  echo "==> Building"
  $VERCEL pull --yes --environment=production --token="$VERCEL_TOKEN"
  $VERCEL build --prod --token="$VERCEL_TOKEN"

  echo "==> Deploying to production"
  local url
  url="$($VERCEL deploy --prebuilt --prod --token="$VERCEL_TOKEN")"
  [ -n "$url" ] || fail "deploy produced no URL"

  verify "$url"
  echo
  echo "Production URL: $url"
}

if [ -n "${VERCEL_TOKEN:-}" ]; then
  deploy_permanent
else
  deploy_temporary
fi
