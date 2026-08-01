## Learned User Preferences
- Distinguish carefully between the transit "trips" dataset (RideCo project `zxmtztietmjfmjyszngb`) and scraped "MLB games" predictions (Various Projects `gwvtpzjzrakggdbiwlyw`).
- Use ESM imports and `"type": "module"` for new Node.js/TypeScript scripts.
- Prefer absolute file paths when referencing directories or code blocks.
- Optimize web scraping tokens by using selective schema field extraction instead of pulling full page text.
- Build MLB prediction models from scraped MyGameSim data only (omit Polymarket influence), using calibrated logistic regression and fractional Kelly sizing against traditional moneyline odds.
- Prefer `@supabase/supabase-js` (or SSR helpers) over the raw `postgres` package for Next.js Supabase data access.
- Review proposed database schema/migration changes before applying them.

## Learned Workspace Facts
- The repository is a Firecrawl monorepo centered on `agent-core` with Next.js frontend templates under `agent-templates/next`; active MLB dashboard work often lives in `agent-templates/next copy`.
- The agent workspace dashboard is at `agent-templates/next/app/(agent)/page.tsx` and the core agent runs via `/api/v1/run`; the MLB predictions dashboard is at `agent-templates/next copy/app/(agent)/predictions` with `/api/predictions` and `/api/cron/retrain-model`.
- Historical compiled MLB prediction data containing 1,498 records is stored in `agent-core copy/scraped_data/all_predictions_compiled.json`.
- The Supabase database project `gwvtpzjzrakggdbiwlyw` ("Various Projects") stores MLB games in `public.mlb_predictions` alongside existing NFL `nflsim` tables.
- Daily MLB scrape/upsert into `public.mlb_predictions` is implemented by `agent-core copy/scripts/daily_scraper_cron.ts`.
- Fitted MLB model parameters are produced by `agent-core copy/analyze_predictions.ts` and saved to `agent-core copy/scraped_data/mlb_predictions_model_params.json`.
- The Supabase database project `zxmtztietmjfmjyszngb` ("RideCo Reporting") holds over 218,000 public transit trips.
- MyGameSim login page is `https://www.mygamesim.com/login.asp` with credentials configured in `~/Development/firecrawl-web-agent/agent-core copy/.env`; authenticated scraping uses the Firecrawl persistent browser profile `mygamesim-session`.
- Alesig Valley Metro Customer Assistance System (CAS) is at `https://vmcrms.alesig.com/caf/`; credentials (`ALESIG_CAF_*`) live in `agent-core copy/.env`; authenticated CAF pulls use the Firecrawl persistent browser profile `alesig-caf-session`. Re-login script: `agent-core copy/examples/9-alesig-caf-login.ts`.
- RideCo Ops (`https://ops.valleymetroconnect.rideco.com`, profile `rideco-ops-session`, re-login `agent-core copy/examples/8-rideco-ops-login.ts`) and Alesig CAF (`alesig-caf-session`) are separate from MyGameSim; in RideCo Ops itineraries, Valley Metro Gilbert/Peoria Garaging Site means shift clock-in and Return to Depot with a time means the shift ended; CAF export/import into `rideco-reporting` is handled in `~/Development/rideco-data-explorer` via `scripts/import_caf_export.py`.
- `agent-core copy/.env` holds MyGameSim, Rocket Money, RideCo Ops (`RIDECO_OPS_*`), Alesig CAF, and Supabase settings.
- API routes are constrained by a 300-second (5-minute) timeout limit, and the Firecrawl `interact` tool execution timeout is capped at 60 seconds.
