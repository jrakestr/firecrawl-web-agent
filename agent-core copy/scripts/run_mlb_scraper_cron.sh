#!/usr/bin/env bash
# Local/manual MLB MyGameSim scrapes → Supabase mlb_predictions.
# Primary schedule: GitHub Actions (.github/workflows/mlb-predictions-scrape.yml).
# Does NOT source .env (keys may contain special chars). Node loads via --env-file.
#
#   ./scripts/run_mlb_scraper_cron.sh [--days N | --date YYYY-MM-DD]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="$ROOT/scraped_data/mlb"
LOG="$OUT_DIR/mlb_scraper_cron.log"

mkdir -p "$OUT_DIR"

export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:$PATH"

cd "$ROOT"

{
  echo "===== $(date -u +%Y-%m-%dT%H:%M:%SZ) run_mlb_scraper_cron ====="
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

# Default: last 3 NY days + tomorrow (script adds tomorrow)
if [[ $# -eq 0 ]]; then
  set -- --days 3
fi

# Tee stdout/stderr into the rolling log for launchd debugging
exec "$NODE_BIN" --env-file=.env --import tsx scripts/daily_scraper_cron.ts "$@" >>"$LOG" 2>&1
