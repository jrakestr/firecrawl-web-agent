#!/usr/bin/env bash
# Wrapper for launchd / manual CAF inbox pulls.
# Does NOT `source` agent-core .env (keys may contain dots). Node loads it via
# --env-file; caf_inbox_cron.ts also parses rideco-data-explorer/.env.local.
#
#   ./scripts/run_caf_inbox_cron.sh [--dry-run|--no-email|--no-login]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="$ROOT/scraped_data/caf"
LOG="$OUT_DIR/caf_inbox_cron.log"

mkdir -p "$OUT_DIR"

export PATH="/usr/local/bin:/opt/homebrew/bin:/Library/Frameworks/Python.framework/Versions/3.13/bin:/usr/bin:/bin:$PATH"

cd "$ROOT"

{
  echo "===== $(date -u +%Y-%m-%dT%H:%M:%SZ) run_caf_inbox_cron ====="
  echo "ROOT=$ROOT"
  echo "args: $*"
} >>"$LOG"

NODE_BIN="$(command -v node || true)"
if [[ -z "$NODE_BIN" && -x /usr/local/bin/node ]]; then NODE_BIN=/usr/local/bin/node; fi
if [[ -z "$NODE_BIN" && -x /opt/homebrew/bin/node ]]; then NODE_BIN=/opt/homebrew/bin/node; fi
if [[ -z "$NODE_BIN" ]]; then
  echo "node not found on PATH" | tee -a "$LOG"
  exit 1
fi

exec "$NODE_BIN" --env-file=.env --import tsx scripts/caf_inbox_cron.ts "$@"
