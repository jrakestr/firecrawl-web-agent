import {
  calibratedPWin,
  kellyFraction,
  moneylineForPredictedWinner,
  type KellyMultiplier,
  type KellyResult,
} from "@/lib/kelly";
import {
  DEFAULT_OU_MONEYLINE,
  type MlbGame,
} from "./schema";

export type MoneylineStatus = "ok" | "missing" | "invalid";

export type OuSide = "Over" | "Under";

export interface SizedOu {
  line: number;
  predictedTotal: number;
  edge: number;
  pOver: number;
  side: OuSide;
  pSide: number;
  moneyline: number;
  kelly: KellyResult | null;
  error: string | null;
}

export interface SizedGame {
  game: MlbGame;
  margin: number;
  pWin: number;
  moneyline: number | null;
  moneylineStatus: MoneylineStatus;
  kelly: KellyResult | null;
  error: string | null;
  ou: SizedOu | null;
}

export interface WhatIfInput {
  awayScore: number;
  homeScore: number;
  moneyline: number;
  bankroll: number;
  b0: number;
  b1: number;
  multiplier: KellyMultiplier;
}

export interface WhatIfResult {
  margin: number;
  pWin: number;
  kelly: KellyResult | null;
  stake: number;
  error: string | null;
}

export type BoardMode = "today" | "recent" | "pending" | "empty";

export interface BoardPartition {
  mode: BoardMode;
  sized: SizedGame[];
  pending: MlbGame[];
}

export interface SizeParams {
  b0: number;
  b1: number;
  ouB0: number;
  ouB1: number;
  multiplier: KellyMultiplier;
  ouMoneyline?: number;
}

export function hasPrediction(game: MlbGame): boolean {
  return Boolean(game.predicted_winner) && game.predicted_margin != null;
}

export function hasOuPrediction(game: MlbGame): boolean {
  return game.predicted_total != null && game.over_under_line != null;
}

/** Size Over/Under from sim total vs line at assumed juice (default −110). */
export function sizeOu(
  game: MlbGame,
  ouB0: number,
  ouB1: number,
  multiplier: KellyMultiplier,
  ouMoneyline: number = DEFAULT_OU_MONEYLINE,
): SizedOu | null {
  if (!hasOuPrediction(game)) return null;

  const predictedTotal = Number(game.predicted_total);
  const line = Number(game.over_under_line);
  if (![predictedTotal, line].every(Number.isFinite)) return null;

  const edge = predictedTotal - line;
  const pOver = calibratedPWin(edge, ouB0, ouB1);
  const side: OuSide = pOver >= 0.5 ? "Over" : "Under";
  const pSide = side === "Over" ? pOver : 1 - pOver;

  try {
    const kelly = kellyFraction(pSide, ouMoneyline, multiplier);
    return {
      line,
      predictedTotal,
      edge,
      pOver,
      side,
      pSide,
      moneyline: ouMoneyline,
      kelly,
      error: null,
    };
  } catch (err) {
    return {
      line,
      predictedTotal,
      edge,
      pOver,
      side,
      pSide,
      moneyline: ouMoneyline,
      kelly: null,
      error: err instanceof Error ? err.message : "Invalid OU moneyline",
    };
  }
}

/** Size one scraped game against the calibrated model + Kelly multiplier. */
export function sizeGame(
  game: MlbGame,
  b0: number,
  b1: number,
  multiplier: KellyMultiplier,
  ouB0: number = 0,
  ouB1: number = 0,
  ouMoneyline: number = DEFAULT_OU_MONEYLINE,
): SizedGame {
  const ou = sizeOu(game, ouB0, ouB1, multiplier, ouMoneyline);

  if (!hasPrediction(game)) {
    return {
      game,
      margin: 0,
      pWin: 0,
      moneyline: null,
      moneylineStatus: "missing",
      kelly: null,
      error: null,
      ou,
    };
  }

  const margin = Math.abs(Number(game.predicted_margin));
  const pWin = calibratedPWin(margin, b0, b1);
  const moneyline = moneylineForPredictedWinner({
    predictedWinner: game.predicted_winner!,
    awayTeam: game.away_team,
    homeTeam: game.home_team,
    awayMoneyline: game.away_moneyline,
    homeMoneyline: game.home_moneyline,
  });

  if (moneyline == null) {
    return {
      game,
      margin,
      pWin,
      moneyline: null,
      moneylineStatus: "missing",
      kelly: null,
      error: null,
      ou,
    };
  }

  try {
    const kelly = kellyFraction(pWin, moneyline, multiplier);
    return {
      game,
      margin,
      pWin,
      moneyline,
      moneylineStatus: "ok",
      kelly,
      error: null,
      ou,
    };
  } catch (err) {
    return {
      game,
      margin,
      pWin,
      moneyline,
      moneylineStatus: "invalid",
      kelly: null,
      error: err instanceof Error ? err.message : "Invalid moneyline",
      ou,
    };
  }
}

/** What-if calculator path (scores typed by the user, not a DB row). */
export function sizeWhatIf(input: WhatIfInput): WhatIfResult | null {
  const {
    awayScore,
    homeScore,
    moneyline,
    bankroll,
    b0,
    b1,
    multiplier,
  } = input;
  if (![awayScore, homeScore, moneyline, bankroll].every(Number.isFinite)) {
    return null;
  }

  const margin = Math.abs(awayScore - homeScore);
  const pWin = calibratedPWin(margin, b0, b1);

  try {
    const kelly = kellyFraction(pWin, moneyline, multiplier);
    return {
      margin,
      pWin,
      kelly,
      stake: kelly.sizedFraction * bankroll,
      error: null,
    };
  } catch (err) {
    return {
      margin,
      pWin,
      kelly: null,
      stake: 0,
      error: err instanceof Error ? err.message : "Invalid moneyline",
    };
  }
}

/** Rank sized games by moneyline Kelly stake descending. */
export function sizeSlate(
  games: MlbGame[],
  b0: number,
  b1: number,
  multiplier: KellyMultiplier,
  ouB0 = 0,
  ouB1 = 0,
): SizedGame[] {
  return games
    .filter(hasPrediction)
    .map((g) => sizeGame(g, b0, b1, multiplier, ouB0, ouB1))
    .sort(
      (a, b) =>
        (b.kelly?.sizedFraction ?? -1) - (a.kelly?.sizedFraction ?? -1),
    );
}

/**
 * Partition a slate for the match grid.
 * today → recent → pending → empty.
 */
export function partitionBoard(
  games: MlbGame[],
  today: string,
  b0: number,
  b1: number,
  multiplier: KellyMultiplier,
  ouB0 = 0,
  ouB1 = 0,
): BoardPartition {
  const sizedAll = sizeSlate(games, b0, b1, multiplier, ouB0, ouB1);
  const pending = games.filter((g) => !hasPrediction(g)).slice(0, 15);
  const todaySized = sizedAll.filter((r) => r.game.date === today);

  if (todaySized.length) {
    return { mode: "today", sized: todaySized, pending: [] };
  }
  if (sizedAll.length) {
    return { mode: "recent", sized: sizedAll.slice(0, 12), pending: [] };
  }
  if (pending.length) {
    return { mode: "pending", sized: [], pending };
  }
  return { mode: "empty", sized: [], pending: [] };
}
