/** Fallback betas when model_params has no row yet (last known fit). */
export const DEFAULT_B0 = 0.07406109851602555;
export const DEFAULT_B1 = 0.114544181204477;

/** Fallback OU betas (edge → P(Over)); replaced when ou_model is present. */
export const DEFAULT_OU_B0 = -0.02222772297519795;
export const DEFAULT_OU_B1 = 0.04851771786939823;

/** Assumed juice when sportsbook OU odds aren't scraped. */
export const DEFAULT_OU_MONEYLINE = -110;

/** Columns the dashboard reads from public.mlb_predictions. */
export const MLB_GAME_SELECT_COLUMNS = [
  "id",
  "date",
  "away_team",
  "home_team",
  "away_pitcher",
  "home_pitcher",
  "away_moneyline",
  "home_moneyline",
  "away_implied_probability",
  "home_implied_probability",
  "over_under_line",
  "predicted_winner",
  "predicted_away_score",
  "predicted_home_score",
  "predicted_margin",
  "predicted_total",
  "actual_away_score",
  "actual_home_score",
  "actual_total_score",
  "actual_winner_team",
  "winner_pick_correct",
] as const;

/** Columns required to retrain / backtest (moneyline + OU). */
export const MLB_BACKTEST_SELECT_COLUMNS = [
  "date",
  "away_team",
  "home_team",
  "predicted_winner",
  "predicted_away_score",
  "predicted_home_score",
  "predicted_margin",
  "predicted_total",
  "over_under_line",
  "actual_away_score",
  "actual_home_score",
  "actual_total_score",
  "actual_winner_team",
  "winner_pick_correct",
] as const;

/**
 * Full write column set for scraper upserts.
 * Keep in sync with agent-core copy/lib/mlb_predictions_schema.ts.
 */
export const MLB_WRITE_COLUMNS = [
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

export interface MlbGame {
  id: string;
  date: string;
  away_team: string;
  home_team: string;
  away_pitcher: string | null;
  home_pitcher: string | null;
  away_moneyline: number | null;
  home_moneyline: number | null;
  away_implied_probability: number | null;
  home_implied_probability: number | null;
  over_under_line: number | null;
  predicted_winner: string | null;
  predicted_away_score: number | null;
  predicted_home_score: number | null;
  predicted_margin: number | null;
  predicted_total: number | null;
  actual_away_score: number | null;
  actual_home_score: number | null;
  actual_total_score: number | null;
  actual_winner_team: string | null;
  winner_pick_correct: boolean | null;
}

/** Subset used by runBacktest — same snake_case as the table. */
export type MlbPredictionRow = Pick<
  MlbGame,
  | "date"
  | "away_team"
  | "home_team"
  | "predicted_winner"
  | "predicted_away_score"
  | "predicted_home_score"
  | "predicted_margin"
  | "predicted_total"
  | "over_under_line"
  | "actual_away_score"
  | "actual_home_score"
  | "actual_total_score"
  | "actual_winner_team"
  | "winner_pick_correct"
>;

export interface CalibrationBin {
  binName: string;
  count: number;
  actualWinRate: number;
  averageModelProb: number;
}

/** CamelCase snapshot written into model_params.team_stats (not the MV). */
export interface TeamStatSnapshot {
  teamName: string;
  totalGames: number;
  winsPredicted: number;
  winsActual: number;
  predictionAccuracy: number;
  brierScore: number;
  biasMagnitude: number;
}

/** Persisted in model_params.ou_model (jsonb). */
export interface OuModelParams {
  b0: number;
  b1: number;
  totalGames: number;
  accuracy: number;
  skillScore: number;
  logLossModel: number;
  logLossBaseline: number;
  oosAccuracy: number;
  oosSkillScore: number;
  calibration: CalibrationBin[];
  trainEndDate: string | null;
  testStartDate: string | null;
}

export interface ModelParamsRow {
  id: string;
  generated_at: string;
  b0: number;
  b1: number;
  total_games: number;
  accuracy: number;
  log_loss_model: number;
  log_loss_baseline: number;
  skill_score: number;
  calibration: CalibrationBin[] | null;
  team_stats: TeamStatSnapshot[] | null;
  train_end_date: string | null;
  test_start_date: string | null;
  notes: string | null;
  ou_model: OuModelParams | null;
}

export interface TeamStatsRow {
  team_name: string;
  total_games: number;
  wins_predicted: number;
  wins_actual: number;
  prediction_accuracy: number;
  brier_score: number;
  bias_magnitude: number;
}

export function gameSelectList(): string {
  return MLB_GAME_SELECT_COLUMNS.join(",");
}

export function backtestSelectList(): string {
  return MLB_BACKTEST_SELECT_COLUMNS.join(",");
}

export function resolveModelBetas(model: ModelParamsRow | null): {
  b0: number;
  b1: number;
} {
  return {
    b0: model?.b0 ?? DEFAULT_B0,
    b1: model?.b1 ?? DEFAULT_B1,
  };
}

export function resolveOuBetas(model: ModelParamsRow | null): {
  ouB0: number;
  ouB1: number;
} {
  return {
    ouB0: model?.ou_model?.b0 ?? DEFAULT_OU_B0,
    ouB1: model?.ou_model?.b1 ?? DEFAULT_OU_B1,
  };
}
