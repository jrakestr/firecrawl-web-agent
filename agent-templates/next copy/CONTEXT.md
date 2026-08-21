# Predictions domain glossary

Terms for the MLB calibration dashboard under `lib/predictions/` and related routes.

| Term | Meaning |
|------|---------|
| **Board** | Server-loaded snapshot: games, model betas, team_stats MV, NY calendar day. Loaded by `loadBoard`. |
| **Sized game** | One `mlb_predictions` row after margin → P(win) → moneyline → Kelly, plus edge → P(Over) → OU Kelly (−110). Produced by `sizeGame`. |
| **OU edge** | `predicted_total − over_under_line`. Logistic maps edge → P(Over); side with p ≥ 0.5 is sized at assumed −110. |
| **Slate partition** | Board view mode: `today` / `recent` / `pending` / `empty`. Produced by `partitionBoard`. |
| **Model params** | Fitted ML logistic β₀/β₁ plus calibration bins; OU fit in `model_params.ou_model` jsonb. |
| **Team stats MV** | Materialized view `team_stats` (snake_case rows). Standings UI reads this only. |
| **Team stats snapshot** | CamelCase JSON on `model_params.team_stats` for audit; not shown in the UI. |
| **Season Elo** | Win/loss Elo from Opening Day (`lib/predictions/elo.ts`). Default K=20, home +24, start 1500. Independent of MyGameSim. |
| **Publishable client** | RLS-scoped Supabase client (`createPublishableClient`). |
| **Secret client** | Bypass-RLS client for retrain writes (`createSecretClient`). |
