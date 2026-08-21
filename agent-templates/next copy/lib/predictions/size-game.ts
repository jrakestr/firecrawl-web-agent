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
import type { EloPreGame } from "./elo";
import {
  assertFiniteNumber,
  assertUnitInterval,
  formatAmericanOdds,
  formatEdgeRuns,
  formatStakePercent,
} from "./format";

export type MoneylineStatus = "ok" | "missing" | "invalid";

export type OuSide = "Over" | "Under";

/**
 * Sized Over/Under view of one game.
 * - pOver: P(total goes Over the line), always
 * - side: recommended side (Over if pOver >= 0.5, else Under)
 * - pSide: P(side) used for Kelly
 * - edge: predicted_total − over_under_line, in runs
 * - moneyline: American odds used for Kelly (default DEFAULT_OU_MONEYLINE)
 */
export interface SizedOu {
  line: number;
  predictedTotal: number;
  /** predicted_total − over_under_line (runs) */
  edge: number;
  /** Always P(Over) */
  pOver: number;
  side: OuSide;
  /** P(side); equals pOver for Over, 1 − pOver for Under */
  pSide: number;
  /** American odds used for Kelly */
  moneyline: number;
  kelly: KellyResult | null;
  error: string | null;
}

/**
 * Season Elo moneyline view (actual results only — not MyGameSim).
 * Picks the +EV side with the larger Kelly stake when both are bettable.
 */
export interface SizedElo {
  awayElo: number;
  homeElo: number;
  side: string;
  pSide: number;
  moneyline: number | null;
  moneylineStatus: MoneylineStatus;
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
  elo: SizedElo | null;
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

/**
 * Board view for the match grid.
 *
 * Invariants (enforced by partitionBoard, covered by tests):
 * - pending: sized is empty, pending may be non-empty
 * - today | recent: pending is empty, sized is non-empty
 * - empty: sized and pending are both empty
 */
export interface BoardPartition {
  mode: BoardMode;
  sized: SizedGame[];
  pending: MlbGame[];
}

export interface BoardCopy {
  title: string;
  blurb: string;
  meta: string;
}

export interface SizeParams {
  b0: number;
  b1: number;
  ouB0: number;
  ouB1: number;
  multiplier: KellyMultiplier;
  ouMoneyline?: number;
}

export type StakeTone = "bet" | "skip" | "muted";

export interface StakeCopy {
  text: string;
  tone: StakeTone;
}

function assertKellyResult(kelly: KellyResult): void {
  assertUnitInterval(kelly.calibratedProb, "calibratedProb");
  assertUnitInterval(kelly.sizedFraction, "sizedFraction");
  assertUnitInterval(kelly.fullKelly, "fullKelly");
}

export function hasPrediction(game: MlbGame): boolean {
  return Boolean(game.predicted_winner) && game.predicted_margin != null;
}

export function hasOuPrediction(game: MlbGame): boolean {
  return game.predicted_total != null && game.over_under_line != null;
}

/** Size Over/Under from sim total vs line at the given American odds. */
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
  assertFiniteNumber(edge, "OU edge");

  const pOver = calibratedPWin(edge, ouB0, ouB1);
  assertUnitInterval(pOver, "pOver");

  const side: OuSide = pOver >= 0.5 ? "Over" : "Under";
  const pSide = side === "Over" ? pOver : 1 - pOver;
  assertUnitInterval(pSide, "pSide");

  try {
    const kelly = kellyFraction(pSide, ouMoneyline, multiplier);
    assertKellyResult(kelly);
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

function isUsableMoneyline(ml: number | null | undefined): ml is number {
  return ml != null && Number.isFinite(ml) && !(ml > -100 && ml < 100);
}

/**
 * Size Elo win probs vs each team's moneyline; keep the better +EV side.
 */
export function sizeElo(
  game: MlbGame,
  pre: EloPreGame,
  multiplier: KellyMultiplier,
): SizedElo {
  assertUnitInterval(pre.pHome, "Elo pHome");
  assertUnitInterval(pre.pAway, "Elo pAway");

  type Cand = {
    side: string;
    pSide: number;
    moneyline: number;
    kelly: KellyResult;
  };
  const bets: Cand[] = [];
  const passes: Cand[] = [];
  let anyInvalid = false;
  let lastError: string | null = null;

  const trySide = (side: string, pSide: number, moneyline: number | null) => {
    if (moneyline == null) {
      return;
    }
    if (!isUsableMoneyline(moneyline)) {
      anyInvalid = true;
      return;
    }
    try {
      const kelly = kellyFraction(pSide, moneyline, multiplier);
      assertKellyResult(kelly);
      const row = { side, pSide, moneyline, kelly };
      if (kelly.recommendation === "BET") bets.push(row);
      else passes.push(row);
    } catch (err) {
      anyInvalid = true;
      lastError = err instanceof Error ? err.message : "Invalid moneyline";
    }
  };

  trySide(game.away_team, pre.pAway, game.away_moneyline);
  trySide(game.home_team, pre.pHome, game.home_moneyline);

  const pick = (rows: Cand[]) =>
    rows.reduce((a, b) =>
      a.kelly.sizedFraction !== b.kelly.sizedFraction
        ? a.kelly.sizedFraction > b.kelly.sizedFraction
          ? a
          : b
        : a.kelly.expectedValue >= b.kelly.expectedValue
          ? a
          : b,
    );

  if (bets.length) {
    const best = pick(bets);
    return {
      awayElo: pre.awayElo,
      homeElo: pre.homeElo,
      side: best.side,
      pSide: best.pSide,
      moneyline: best.moneyline,
      moneylineStatus: "ok",
      kelly: best.kelly,
      error: null,
    };
  }

  if (passes.length) {
    const best = passes.reduce((a, b) =>
      a.kelly.expectedValue >= b.kelly.expectedValue ? a : b,
    );
    return {
      awayElo: pre.awayElo,
      homeElo: pre.homeElo,
      side: best.side,
      pSide: best.pSide,
      moneyline: best.moneyline,
      moneylineStatus: "ok",
      kelly: best.kelly,
      error: null,
    };
  }

  const favorite =
    pre.pHome >= pre.pAway
      ? {
          side: game.home_team,
          pSide: pre.pHome,
          moneyline: game.home_moneyline,
        }
      : {
          side: game.away_team,
          pSide: pre.pAway,
          moneyline: game.away_moneyline,
        };

  return {
    awayElo: pre.awayElo,
    homeElo: pre.homeElo,
    side: favorite.side,
    pSide: favorite.pSide,
    moneyline: favorite.moneyline,
    moneylineStatus: anyInvalid ? "invalid" : "missing",
    kelly: null,
    error: lastError,
  };
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
  eloPre: EloPreGame | null = null,
): SizedGame {
  const ou = sizeOu(game, ouB0, ouB1, multiplier, ouMoneyline);
  const elo = eloPre ? sizeElo(game, eloPre, multiplier) : null;

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
      elo,
    };
  }

  const margin = Math.abs(Number(game.predicted_margin));
  assertFiniteNumber(margin, "predicted margin");
  const pWin = calibratedPWin(margin, b0, b1);
  assertUnitInterval(pWin, "pWin");

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
      elo,
    };
  }

  try {
    const kelly = kellyFraction(pWin, moneyline, multiplier);
    assertKellyResult(kelly);
    return {
      game,
      margin,
      pWin,
      moneyline,
      moneylineStatus: "ok",
      kelly,
      error: null,
      ou,
      elo,
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
      elo,
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
  assertUnitInterval(pWin, "pWin");

  try {
    const kelly = kellyFraction(pWin, moneyline, multiplier);
    assertKellyResult(kelly);
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
  games: readonly MlbGame[],
  b0: number,
  b1: number,
  multiplier: KellyMultiplier,
  ouB0 = 0,
  ouB1 = 0,
  eloPreById: Readonly<Record<string, EloPreGame>> | null = null,
): SizedGame[] {
  return games
    .filter(hasPrediction)
    .map((g) =>
      sizeGame(
        g,
        b0,
        b1,
        multiplier,
        ouB0,
        ouB1,
        DEFAULT_OU_MONEYLINE,
        eloPreById?.[g.id] ?? null,
      ),
    )
    .sort(
      (a, b) =>
        (b.kelly?.sizedFraction ?? -1) - (a.kelly?.sizedFraction ?? -1),
    );
}

/**
 * Partition a slate for the match grid.
 * Priority: today → recent → pending → empty.
 * Does not mutate `games`.
 */
export function partitionBoard(
  games: readonly MlbGame[],
  today: string,
  b0: number,
  b1: number,
  multiplier: KellyMultiplier,
  ouB0 = 0,
  ouB1 = 0,
  eloPreById: Readonly<Record<string, EloPreGame>> | null = null,
): BoardPartition {
  const sizedAll = sizeSlate(
    games,
    b0,
    b1,
    multiplier,
    ouB0,
    ouB1,
    eloPreById,
  );
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

/** Exhaustive mode → title/blurb/meta. Pending never claims a calendar day. */
export function boardCopyForMode(
  mode: BoardMode,
  opts: { sizedCount: number; pendingCount: number; multiplier: number },
): BoardCopy {
  switch (mode) {
    case "today":
      return {
        title: "Today's board",
        blurb:
          "Pick a game. The big % is the model's chance. Under it, bet that slice of bankroll, or skip.",
        meta: `${opts.sizedCount} games · Kelly ×${opts.multiplier}`,
      };
    case "recent":
      return {
        title: "Recent games",
        blurb:
          "Pick a game. The big % is the model's chance. Under it, bet that slice of bankroll, or skip.",
        meta: `${opts.sizedCount} games · Kelly ×${opts.multiplier}`,
      };
    case "pending":
      return {
        title: "Sims still running",
        blurb:
          "Games are posted, but MyGameSim has not finished the sims. Chance and stake show up once scores and moneylines land.",
        meta: `${opts.pendingCount} matchups · pending sims`,
      };
    case "empty":
      return {
        title: "Matchups",
        blurb: "No games in the feed yet. The daily scrape fills this board.",
        meta: "0 games",
      };
    default: {
      const _exhaustive: never = mode;
      return _exhaustive;
    }
  }
}

export function moneylineStakeCopy(
  kelly: KellyResult | null,
  moneylineStatus: MoneylineStatus,
  moneyline: number | null,
): StakeCopy {
  const line = `Line ${formatAmericanOdds(moneyline)}`;
  if (kelly) {
    if (kelly.recommendation === "BET") {
      return {
        text: `${line} · Bet ${formatStakePercent(kelly.sizedFraction)} of bankroll`,
        tone: "bet",
      };
    }
    return {
      text: `${line} · Skip · no edge at this line`,
      tone: "skip",
    };
  }
  if (moneylineStatus === "invalid") {
    return { text: `${line} · Skip · moneyline looks broken`, tone: "skip" };
  }
  return { text: "No moneyline yet", tone: "muted" };
}

export function ouStakeCopy(ou: SizedOu): StakeCopy {
  const edgeBit = `Sim - line ${formatEdgeRuns(ou.edge)} @ ${formatAmericanOdds(ou.moneyline)}`;
  if (ou.kelly) {
    if (ou.kelly.recommendation === "BET") {
      return {
        text: `${edgeBit} · Bet ${ou.side} ${formatStakePercent(ou.kelly.sizedFraction)}`,
        tone: "bet",
      };
    }
    return {
      text: `${edgeBit} · Skip · no edge at ${formatAmericanOdds(ou.moneyline)}`,
      tone: "skip",
    };
  }
  if (ou.error) {
    return { text: "OU unavailable", tone: "muted" };
  }
  return { text: "OU unavailable", tone: "muted" };
}

export function eloStakeCopy(elo: SizedElo): StakeCopy {
  const line = `Line ${formatAmericanOdds(elo.moneyline)}`;
  if (elo.kelly) {
    if (elo.kelly.recommendation === "BET") {
      return {
        text: `${line} · Bet ${formatStakePercent(elo.kelly.sizedFraction)} of bankroll`,
        tone: "bet",
      };
    }
    return {
      text: `${line} · Skip · no edge at this line`,
      tone: "skip",
    };
  }
  if (elo.moneylineStatus === "invalid") {
    return { text: `${line} · Skip · moneyline looks broken`, tone: "skip" };
  }
  return { text: "No moneyline yet", tone: "muted" };
}
