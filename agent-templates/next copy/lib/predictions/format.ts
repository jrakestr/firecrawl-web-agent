/** Display helpers for odds and board numbers (no I/O). */

/**
 * Format American odds with a leading sign.
 * Returns "—" for null/non-finite values.
 */
export function formatAmericanOdds(moneyline: number | null | undefined): string {
  if (moneyline == null || !Number.isFinite(moneyline)) return "—";
  if (moneyline > 0) return `+${moneyline}`;
  return String(moneyline);
}

/** Format a signed run edge, e.g. +1.6 or -0.4. */
export function formatEdgeRuns(edge: number): string {
  if (!Number.isFinite(edge)) return "—";
  const body = Math.abs(edge).toFixed(1);
  return edge >= 0 ? `+${body}` : `-${body}`;
}

/** Probability as percent string, e.g. 55.9%. Throws if out of [0, 1]. */
export function formatProbPercent(p: number): string {
  assertUnitInterval(p, "probability");
  return `${(p * 100).toFixed(1)}%`;
}

/** Bankroll fraction as percent string. Throws if out of [0, 1]. */
export function formatStakePercent(fraction: number): string {
  assertUnitInterval(fraction, "stake fraction");
  return `${(fraction * 100).toFixed(1)}%`;
}

export function assertUnitInterval(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
}

export function assertFiniteNumber(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
}
