/** Pure Kelly Criterion + sigmoid calibration helpers (no I/O). */

export type KellyMultiplier = 1 | 0.5 | 0.25;

export interface KellyResult {
  decimalOdds: number;
  netOdds: number;
  calibratedProb: number;
  fullKelly: number;
  sizedFraction: number;
  expectedValue: number;
  recommendation: "BET" | "PASS";
}

export interface MatchTeams {
  predictedWinner: string;
  awayTeam: string;
  homeTeam: string;
  awayMoneyline: number | null;
  homeMoneyline: number | null;
}

/**
 * Converts American moneyline odds to decimal odds.
 * @throws {Error} If moneyline is non-finite or in the invalid open interval (-100, 100).
 */
export function americanToDecimal(moneyline: number): number {
  if (!Number.isFinite(moneyline) || (moneyline > -100 && moneyline < 100)) {
    throw new Error(`Invalid American moneyline odds: ${moneyline}`);
  }
  return moneyline < 0 ? 100 / Math.abs(moneyline) + 1 : moneyline / 100 + 1;
}

/**
 * Numerically stable sigmoid: maps log-odds to (0, 1).
 * Avoids overflow for large |z| when computing Math.exp(-z).
 */
export function stableSigmoid(z: number): number {
  if (z >= 0) {
    return 1 / (1 + Math.exp(-z));
  }
  const expZ = Math.exp(z);
  return expZ / (1 + expZ);
}

/**
 * Win probability from fitted logistic regression on predicted margin.
 * Clamps to [minProb, maxProb] to keep log-loss / Kelly math finite.
 */
export function calibratedPWin(
  margin: number,
  b0: number,
  b1: number,
  minProb = 0.0001,
  maxProb = 0.9999,
): number {
  const z = b0 + b1 * margin;
  const p = stableSigmoid(z);
  return Math.max(minProb, Math.min(maxProb, p));
}

/**
 * Fractional Kelly sizing.
 * f* = (p·d − 1) / (d − 1) = EV / netOdds, clamped to [0, 1], then × multiplier.
 * PASS when EV ≤ 0 or netOdds ≤ 0.
 */
export function kellyFraction(
  calibratedProb: number,
  moneyline: number,
  multiplier: KellyMultiplier = 0.5,
): KellyResult {
  const decimalOdds = americanToDecimal(moneyline);
  const netOdds = decimalOdds - 1;
  const expectedValue = calibratedProb * decimalOdds - 1;

  if (netOdds <= 0 || expectedValue <= 0) {
    return {
      decimalOdds,
      netOdds,
      calibratedProb,
      fullKelly: 0,
      sizedFraction: 0,
      expectedValue,
      recommendation: "PASS",
    };
  }

  const rawKelly = expectedValue / netOdds;
  const fullKelly = Math.max(0, Math.min(1, rawKelly));
  const sizedFraction = fullKelly * multiplier;

  return {
    decimalOdds,
    netOdds,
    calibratedProb,
    fullKelly,
    sizedFraction,
    expectedValue,
    recommendation: "BET",
  };
}

/**
 * Resolves moneyline for the predicted winner via case-insensitive trim match.
 */
export function moneylineForPredictedWinner(opts: MatchTeams): number | null {
  const { predictedWinner, awayTeam, homeTeam, awayMoneyline, homeMoneyline } =
    opts;

  const target = predictedWinner.trim().toLowerCase();
  const away = awayTeam.trim().toLowerCase();
  const home = homeTeam.trim().toLowerCase();

  if (target === away) return awayMoneyline;
  if (target === home) return homeMoneyline;

  return null;
}
