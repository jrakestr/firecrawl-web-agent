## Learned User Preferences
- Distinguish carefully between the transit "trips" dataset (RideCo project `zxmtztietmjfmjyszngb`) and scraped "MLB games" predictions (Various Projects `gwvtpzjzrakggdbiwlyw`).
- Use ESM imports and `"type": "module"` for new Node.js/TypeScript scripts.
- Prefer absolute file paths when referencing directories or code blocks.
- Optimize web scraping tokens by using selective schema field extraction instead of pulling full page text.
- Formulate predictions using calibrated logistic regression and Kelly Criterion bet sizing with custom fractional multipliers (Full, Half, Quarter) for Polymarket.

## Learned Workspace Facts
- The repository is a Firecrawl monorepo centered on `agent-core` with Next.js frontend templates under `agent-templates/next`.
- The agent workspace dashboard is at `agent-templates/next/app/(agent)/page.tsx` and the core agent runs via `/api/v1/run`.
- Historical compiled MLB prediction data containing 1,498 records is stored in `agent-core copy/scraped_data/all_predictions_compiled.json`.
- The Supabase database project `gwvtpzjzrakggdbiwlyw` ("Various Projects") stores MLB and NFL game predictions.
- The Supabase database project `zxmtztietmjfmjyszngb` ("RideCo Reporting") holds over 218,000 public transit trips.
- MyGameSim login page is `https://www.mygamesim.com/login.asp` with credentials configured in `~/Development/firecrawl-web-agent/agent-core copy/.env`.
- API routes are constrained by a 300-second (5-minute) timeout limit, and the Firecrawl `interact` tool execution timeout is capped at 60 seconds.
- Background worker progress in `agent-core/src/worker/index.ts` is transient and stored in an in-memory Map.