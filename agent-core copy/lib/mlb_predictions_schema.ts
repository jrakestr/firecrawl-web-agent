/**
 * Shared write schema for public.mlb_predictions.
 * Keep column order in sync with
 * agent-templates/next copy/lib/predictions/schema.ts → MLB_WRITE_COLUMNS.
 */
export const MLB_PREDICTION_COLUMNS = [
  "date",
  "year",
  "month",
  "day",
  "day_of_week",
  "away_team",
  "home_team",
  "away_pitcher",
  "home_pitcher",
  "away_moneyline",
  "home_moneyline",
  "away_implied_probability",
  "home_implied_probability",
  "away_spread",
  "home_spread",
  "over_under_line",
  "predicted_winner",
  "predicted_away_score",
  "predicted_home_score",
  "predicted_winner_score",
  "predicted_loser_score",
  "predicted_margin",
  "predicted_total",
  "actual_away_score",
  "actual_home_score",
  "actual_winner_team",
  "actual_winner",
  "actual_margin",
  "actual_total_score",
  "winner_pick_correct",
  "margin_pick_correct",
  "spread_pick_correct",
] as const;

export type MlbPredictionColumn = (typeof MLB_PREDICTION_COLUMNS)[number];

type SqlTag = (
  strings: TemplateStringsArray,
  ...values: unknown[]
) => Promise<unknown>;

/** Refresh team_stats MV — single writer path for the scraper. */
export async function refreshTeamStatsSql(
  sql: SqlTag,
): Promise<"concurrent" | "blocking"> {
  try {
    await sql`REFRESH MATERIALIZED VIEW CONCURRENTLY public.team_stats`;
    return "concurrent";
  } catch {
    await sql`REFRESH MATERIALIZED VIEW public.team_stats`;
    return "blocking";
  }
}
