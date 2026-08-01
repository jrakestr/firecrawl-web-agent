/** Pure backtest / logistic calibration — no file I/O, no console. */

import { calibratedPWin, stableSigmoid } from "./kelly";
import type {
  CalibrationBin,
  MlbPredictionRow,
  OuModelParams,
  TeamStatSnapshot,
} from "./predictions/schema";

export type { CalibrationBin, MlbPredictionRow, TeamStatSnapshot };

export interface BacktestMetrics {
  totalGames: number;
  trainGames: number;
  testGames: number;
  accuracy: number;
  oosAccuracy: number;
  logLossModel: number;
  logLossBaseline: number;
  skillScore: number;
  oosLogLossModel: number;
  oosSkillScore: number;
}

export interface BacktestResult {
  b0: number;
  b1: number;
  metrics: BacktestMetrics;
  calibration: CalibrationBin[];
  teamStats: TeamStatSnapshot[];
  trainEndDate: string | null;
  testStartDate: string | null;
  /** Calibrated Over/Under model; null if fewer than 50 settled OU games. */
  ou: OuModelParams | null;
}

interface ParsedGame {
  date: string;
  awayTeam: string;
  homeTeam: string;
  predictedWinner: string;
  predictedMargin: number;
  predictedAwayScore: number;
  predictedHomeScore: number;
  actualAwayScore: number;
  actualHomeScore: number;
  actualWinner: string;
  didPredictedWinnerWin: boolean;
}

const MARGIN_BINS = [
  { name: "0.0 - 0.4 runs", min: 0, max: 0.4 },
  { name: "0.4 - 0.8 runs", min: 0.4, max: 0.8 },
  { name: "0.8 - 1.2 runs", min: 0.8, max: 1.2 },
  { name: "1.2 - 1.6 runs", min: 1.2, max: 1.6 },
  { name: "1.6+ runs", min: 1.6, max: Infinity },
] as const;

/** Edge = predicted_total − over_under_line (signed). */
const EDGE_BINS = [
  { name: "≤ −2.5", min: -Infinity, max: -2.5 },
  { name: "−2.5 – −1.0", min: -2.5, max: -1.0 },
  { name: "−1.0 – 0", min: -1.0, max: 0 },
  { name: "0 – 1.0", min: 0, max: 1.0 },
  { name: "1.0 – 2.5", min: 1.0, max: 2.5 },
  { name: "≥ 2.5", min: 2.5, max: Infinity },
] as const;

const B1_MAX_NORM = 5;
const CONVERGENCE_EPS = 1e-6;
const DEFAULT_HOLDOUT_DAYS = 14;
const MIN_OU_GAMES = 50;

interface ParsedOuGame {
  date: string;
  edge: number;
  wentOver: boolean;
}

function parseGames(rows: MlbPredictionRow[]): ParsedGame[] {
  if (!Array.isArray(rows)) {
    throw new Error("Invalid data format: games array not found");
  }

  const out: ParsedGame[] = [];
  for (const row of rows) {
    if (
      !row?.actual_winner_team ||
      !row.predicted_winner ||
      row.predicted_margin == null ||
      row.predicted_away_score == null ||
      row.predicted_home_score == null ||
      row.actual_away_score == null ||
      row.actual_home_score == null
    ) {
      continue;
    }

    const predictedMargin = Number(row.predicted_margin);
    const predictedAwayScore = Number(row.predicted_away_score);
    const predictedHomeScore = Number(row.predicted_home_score);
    const actualAwayScore = Number(row.actual_away_score);
    const actualHomeScore = Number(row.actual_home_score);

    if (
      ![
        predictedMargin,
        predictedAwayScore,
        predictedHomeScore,
        actualAwayScore,
        actualHomeScore,
      ].every(Number.isFinite)
    ) {
      continue;
    }

    const didPredictedWinnerWin =
      row.actual_winner_team.toLowerCase() ===
      row.predicted_winner.toLowerCase();

    out.push({
      date: String(row.date).slice(0, 10),
      awayTeam: row.away_team,
      homeTeam: row.home_team,
      predictedWinner: row.predicted_winner,
      predictedMargin: Math.abs(predictedMargin),
      predictedAwayScore,
      predictedHomeScore,
      actualAwayScore,
      actualHomeScore,
      actualWinner: row.actual_winner_team,
      didPredictedWinnerWin,
    });
  }
  return out;
}

function logLoss(games: ParsedGame[], b0: number, b1: number, baseRate: number) {
  let model = 0;
  let baseline = 0;
  for (const g of games) {
    const y = g.didPredictedWinnerWin ? 1 : 0;
    const p = calibratedPWin(g.predictedMargin, b0, b1);
    model += -(y * Math.log(p) + (1 - y) * Math.log(1 - p));
    const pb = Math.max(0.0001, Math.min(0.9999, baseRate));
    baseline += -(y * Math.log(pb) + (1 - y) * Math.log(1 - pb));
  }
  const n = games.length || 1;
  return { model: model / n, baseline: baseline / n };
}

function fitBinaryLogistic(
  xs: number[],
  ys: number[],
): { b0: number; b1: number } {
  let b0 = 0;
  let b1 = 0.5;
  const learningRate = 0.1;
  const epochs = 3000;
  let prevLoss = Infinity;
  const n = xs.length || 1;

  for (let epoch = 0; epoch < epochs; epoch++) {
    let db0 = 0;
    let db1 = 0;
    let loss = 0;
    for (let i = 0; i < xs.length; i++) {
      const x = xs[i];
      const y = ys[i];
      const p = stableSigmoid(b0 + b1 * x);
      const error = p - y;
      db0 += error;
      db1 += error * x;
      loss += -(y * Math.log(p) + (1 - y) * Math.log(1 - p));
    }
    b0 -= (learningRate * db0) / n;
    b1 -= (learningRate * db1) / n;
    b1 = Math.max(-B1_MAX_NORM, Math.min(B1_MAX_NORM, b1));

    if (epoch % 50 === 0 || epoch === epochs - 1) {
      const avg = loss / n;
      if (Math.abs(prevLoss - avg) < CONVERGENCE_EPS) break;
      prevLoss = avg;
    }
  }

  return { b0, b1 };
}

function fitLogistic(games: ParsedGame[]): { b0: number; b1: number } {
  return fitBinaryLogistic(
    games.map((g) => g.predictedMargin),
    games.map((g) => (g.didPredictedWinnerWin ? 1 : 0)),
  );
}

function parseOuGames(rows: MlbPredictionRow[]): ParsedOuGame[] {
  const out: ParsedOuGame[] = [];
  for (const row of rows) {
    if (
      row.predicted_total == null ||
      row.over_under_line == null ||
      row.actual_total_score == null
    ) {
      continue;
    }
    const predictedTotal = Number(row.predicted_total);
    const line = Number(row.over_under_line);
    const actual = Number(row.actual_total_score);
    if (![predictedTotal, line, actual].every(Number.isFinite)) continue;
    // Pushes (exact line) are neither Over nor Under — skip.
    if (actual === line) continue;

    out.push({
      date: String(row.date).slice(0, 10),
      edge: predictedTotal - line,
      wentOver: actual > line,
    });
  }
  return out;
}

function ouLogLoss(
  games: ParsedOuGame[],
  b0: number,
  b1: number,
  baseRate: number,
) {
  let model = 0;
  let baseline = 0;
  for (const g of games) {
    const y = g.wentOver ? 1 : 0;
    const p = calibratedPWin(g.edge, b0, b1);
    model += -(y * Math.log(p) + (1 - y) * Math.log(1 - p));
    const pb = Math.max(0.0001, Math.min(0.9999, baseRate));
    baseline += -(y * Math.log(pb) + (1 - y) * Math.log(1 - pb));
  }
  const n = games.length || 1;
  return { model: model / n, baseline: baseline / n };
}

function buildOuCalibration(
  games: ParsedOuGame[],
  b0: number,
  b1: number,
): CalibrationBin[] {
  const bins = EDGE_BINS.map((b) => ({
    binName: b.name,
    count: 0,
    overs: 0,
    sumProb: 0,
  }));

  for (const g of games) {
    const p = calibratedPWin(g.edge, b0, b1);
    const idx = EDGE_BINS.findIndex(
      (b) =>
        g.edge >= b.min && (b.max === Infinity ? true : g.edge < b.max),
    );
    if (idx >= 0) {
      bins[idx].count++;
      bins[idx].sumProb += p;
      if (g.wentOver) bins[idx].overs++;
    }
  }

  return bins.map((b) => ({
    binName: b.binName,
    count: b.count,
    actualWinRate: b.count > 0 ? b.overs / b.count : 0,
    averageModelProb: b.count > 0 ? b.sumProb / b.count : 0,
  }));
}

function temporalSplit<T extends { date: string }>(
  games: T[],
  holdoutDays: number,
): { train: T[]; test: T[] } {
  const sorted = [...games].sort((a, b) => a.date.localeCompare(b.date));
  const maxDate = sorted[sorted.length - 1].date;
  const cutoff = new Date(`${maxDate}T12:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - holdoutDays);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  let train = sorted.filter((g) => g.date < cutoffStr);
  let test = sorted.filter((g) => g.date >= cutoffStr);

  if (train.length < 30 || test.length < 10) {
    const splitIdx = Math.floor(sorted.length * 0.85);
    train = sorted.slice(0, splitIdx);
    test = sorted.slice(splitIdx);
  }
  return { train, test };
}

function fitOuModel(
  rows: MlbPredictionRow[],
  holdoutDays: number,
): OuModelParams | null {
  const games = parseOuGames(rows);
  if (games.length < MIN_OU_GAMES) return null;

  const { train, test } = temporalSplit(games, holdoutDays);
  const { b0, b1 } = fitBinaryLogistic(
    train.map((g) => g.edge),
    train.map((g) => (g.wentOver ? 1 : 0)),
  );

  const trainOvers = train.filter((g) => g.wentOver).length;
  const testOvers = test.filter((g) => g.wentOver).length;
  const allOvers = games.filter((g) => g.wentOver).length;
  const trainBase = trainOvers / train.length;

  const trainLl = ouLogLoss(train, b0, b1, trainBase);
  const testLl = ouLogLoss(test, b0, b1, trainBase);
  const allLl = ouLogLoss(games, b0, b1, allOvers / games.length);

  // Accuracy: model picks Over when p>0.5
  const sideHit = (set: ParsedOuGame[]) => {
    let hits = 0;
    for (const g of set) {
      const p = calibratedPWin(g.edge, b0, b1);
      const pickOver = p >= 0.5;
      if (pickOver === g.wentOver) hits++;
    }
    return set.length ? hits / set.length : 0;
  };

  return {
    b0,
    b1,
    totalGames: games.length,
    accuracy: sideHit(games),
    skillScore: 1 - allLl.model / allLl.baseline,
    logLossModel: allLl.model,
    logLossBaseline: allLl.baseline,
    oosAccuracy: sideHit(test),
    oosSkillScore: 1 - testLl.model / testLl.baseline,
    calibration: buildOuCalibration(games, b0, b1),
    trainEndDate: train.length ? train[train.length - 1].date : null,
    testStartDate: test.length ? test[0].date : null,
  };
}

function buildCalibration(
  games: ParsedGame[],
  b0: number,
  b1: number,
): CalibrationBin[] {
  const bins = MARGIN_BINS.map((b) => ({
    binName: b.name,
    count: 0,
    wins: 0,
    sumProb: 0,
  }));

  for (const g of games) {
    const p = calibratedPWin(g.predictedMargin, b0, b1);
    const idx = MARGIN_BINS.findIndex(
      (b) =>
        g.predictedMargin >= b.min &&
        (b.max === Infinity ? true : g.predictedMargin < b.max),
    );
    if (idx >= 0) {
      bins[idx].count++;
      bins[idx].sumProb += p;
      if (g.didPredictedWinnerWin) bins[idx].wins++;
    }
  }

  return bins.map((b) => ({
    binName: b.binName,
    count: b.count,
    actualWinRate: b.count > 0 ? b.wins / b.count : 0,
    averageModelProb: b.count > 0 ? b.sumProb / b.count : 0,
  }));
}

function buildTeamStats(
  games: ParsedGame[],
  b0: number,
  b1: number,
): TeamStatSnapshot[] {
  type Acc = {
    totalGames: number;
    winsPredicted: number;
    winsActual: number;
    correctPicks: number;
    brierSum: number;
    biasSum: number;
  };
  const map = new Map<string, Acc>();

  for (const g of games) {
    for (const team of [g.awayTeam, g.homeTeam]) {
      let a = map.get(team);
      if (!a) {
        a = {
          totalGames: 0,
          winsPredicted: 0,
          winsActual: 0,
          correctPicks: 0,
          brierSum: 0,
          biasSum: 0,
        };
        map.set(team, a);
      }
      const side = team === g.awayTeam ? "away" : "home";
      const predMargin =
        side === "away"
          ? g.predictedAwayScore - g.predictedHomeScore
          : g.predictedHomeScore - g.predictedAwayScore;
      const actMargin =
        side === "away"
          ? g.actualAwayScore - g.actualHomeScore
          : g.actualHomeScore - g.actualAwayScore;
      const pWin = calibratedPWin(g.predictedMargin, b0, b1);
      const y = g.didPredictedWinnerWin ? 1 : 0;

      a.totalGames++;
      if (g.predictedWinner === team) a.winsPredicted++;
      if (g.actualWinner === team) a.winsActual++;
      if (g.didPredictedWinnerWin) a.correctPicks++;
      a.brierSum += (pWin - y) ** 2;
      a.biasSum += predMargin - actMargin;
    }
  }

  return [...map.entries()]
    .map(([teamName, a]) => ({
      teamName,
      totalGames: a.totalGames,
      winsPredicted: a.winsPredicted,
      winsActual: a.winsActual,
      predictionAccuracy: a.totalGames > 0 ? a.correctPicks / a.totalGames : 0,
      brierScore: a.totalGames > 0 ? a.brierSum / a.totalGames : 0,
      biasMagnitude: a.totalGames > 0 ? a.biasSum / a.totalGames : 0,
    }))
    .sort((a, b) => a.brierScore - b.brierScore);
}

/**
 * Fit logistic calibration with temporal holdout.
 * @param holdoutDays recent days reserved for OOS evaluation (default 14)
 */
export function runBacktest(
  rows: MlbPredictionRow[],
  holdoutDays: number = DEFAULT_HOLDOUT_DAYS,
): BacktestResult {
  const games = parseGames(rows);
  if (games.length < 50) {
    throw new Error(
      `Need at least 50 completed games to backtest; got ${games.length}`,
    );
  }

  const { train, test } = temporalSplit(games, holdoutDays);
  const { b0, b1 } = fitLogistic(train);

  const trainCorrect = train.filter((g) => g.didPredictedWinnerWin).length;
  const testCorrect = test.filter((g) => g.didPredictedWinnerWin).length;
  const trainBase = trainCorrect / train.length;
  const allCorrect = games.filter((g) => g.didPredictedWinnerWin).length;

  const trainLl = logLoss(train, b0, b1, trainBase);
  const testLl = logLoss(test, b0, b1, trainBase);
  const allLl = logLoss(games, b0, b1, allCorrect / games.length);

  const skillScore = 1 - allLl.model / allLl.baseline;
  const oosSkillScore = 1 - testLl.model / testLl.baseline;

  return {
    b0,
    b1,
    metrics: {
      totalGames: games.length,
      trainGames: train.length,
      testGames: test.length,
      accuracy: allCorrect / games.length,
      oosAccuracy: test.length ? testCorrect / test.length : 0,
      logLossModel: allLl.model,
      logLossBaseline: allLl.baseline,
      skillScore,
      oosLogLossModel: testLl.model,
      oosSkillScore,
    },
    calibration: buildCalibration(games, b0, b1),
    teamStats: buildTeamStats(games, b0, b1),
    trainEndDate: train.length ? train[train.length - 1].date : null,
    testStartDate: test.length ? test[0].date : null,
    ou: fitOuModel(rows, holdoutDays),
  };
}
