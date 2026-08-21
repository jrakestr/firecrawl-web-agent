import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  boardCopyForMode,
  ouStakeCopy,
  partitionBoard,
  sizeElo,
  sizeGame,
  sizeOu,
  sizeWhatIf,
} from "./size-game";
import { formatAmericanOdds } from "./format";
import type { MlbGame } from "./schema";

const baseGame = (overrides: Partial<MlbGame> = {}): MlbGame => ({
  id: "1",
  date: "2026-07-30",
  away_team: "Yankees",
  home_team: "Red Sox",
  away_pitcher: null,
  home_pitcher: null,
  away_moneyline: 120,
  home_moneyline: -140,
  away_implied_probability: null,
  home_implied_probability: null,
  predicted_winner: "Red Sox",
  predicted_away_score: 3.8,
  predicted_home_score: 4.5,
  predicted_margin: 0.7,
  predicted_total: 8.3,
  over_under_line: 8.5,
  actual_away_score: null,
  actual_home_score: null,
  actual_total_score: null,
  actual_winner_team: null,
  winner_pick_correct: null,
  ...overrides,
});

describe("sizeGame", () => {
  it("sizes a predicted winner with a moneyline", () => {
    const sized = sizeGame(baseGame(), 0.07, 0.11, 0.5, -0.12, 0.18);
    assert.equal(sized.moneylineStatus, "ok");
    assert.ok(sized.kelly);
    assert.ok(sized.pWin > 0.5);
    assert.ok(sized.ou);
    assert.equal(sized.ou!.line, 8.5);
    assert.equal(sized.elo, null);
  });

  it("attaches Elo sizing when pre-game Elo is provided", () => {
    const sized = sizeGame(
      baseGame(),
      0.07,
      0.11,
      0.5,
      -0.12,
      0.18,
      -110,
      { awayElo: 1480, homeElo: 1520, pHome: 0.58, pAway: 0.42 },
    );
    assert.ok(sized.elo);
    assert.equal(sized.elo!.homeElo, 1520);
    assert.ok(sized.elo!.pSide > 0);
  });

  it("flags missing moneyline", () => {
    const sized = sizeGame(
      baseGame({ away_moneyline: null, home_moneyline: null }),
      0.07,
      0.11,
      0.5,
      -0.12,
      0.18,
    );
    assert.equal(sized.moneylineStatus, "missing");
    assert.equal(sized.kelly, null);
    assert.ok(sized.ou);
  });
});

describe("sizeElo", () => {
  it("bets the +EV Elo side", () => {
    const elo = sizeElo(
      baseGame({
        away_moneyline: 200,
        home_moneyline: -240,
      }),
      { awayElo: 1550, homeElo: 1450, pHome: 0.4, pAway: 0.6 },
      0.5,
    );
    assert.equal(elo.side, "Yankees");
    assert.ok(elo.kelly);
    assert.equal(elo.kelly!.recommendation, "BET");
  });
});

describe("sizeOu", () => {
  it("recommends Under and sets pSide = 1 - pOver", () => {
    // Negative edge + negative intercept → pOver < 0.5
    const ou = sizeOu(
      baseGame({ predicted_total: 7.0, over_under_line: 9.5 }),
      -0.5,
      0.1,
      0.5,
      -110,
    );
    assert.ok(ou);
    assert.equal(ou!.side, "Under");
    assert.ok(ou!.pOver < 0.5);
    assert.equal(ou!.pSide, 1 - ou!.pOver);
  });

  it("uses the passed OU moneyline in stake copy", () => {
    const ou = sizeOu(
      baseGame({ predicted_total: 11, over_under_line: 8 }),
      -0.02,
      0.2,
      0.5,
      -105,
    );
    assert.ok(ou);
    assert.equal(ou!.moneyline, -105);
    const copy = ouStakeCopy(ou!);
    assert.match(copy.text, /-105/);
    assert.doesNotMatch(copy.text, /-110/);
  });
});

describe("formatAmericanOdds", () => {
  it("adds a plus for positives", () => {
    assert.equal(formatAmericanOdds(120), "+120");
    assert.equal(formatAmericanOdds(-140), "-140");
    assert.equal(formatAmericanOdds(null), "—");
  });
});

describe("sizeWhatIf", () => {
  it("returns a stake for a +EV line", () => {
    const result = sizeWhatIf({
      awayScore: 5,
      homeScore: 3,
      moneyline: -110,
      bankroll: 10000,
      b0: 0.07,
      b1: 0.11,
      multiplier: 0.5,
    });
    assert.ok(result);
    assert.ok(result!.kelly);
    assert.equal(result!.error, null);
  });
});

describe("partitionBoard", () => {
  it("prefers today's sized games with empty pending", () => {
    const board = partitionBoard(
      [
        baseGame({ date: "2026-07-30" }),
        baseGame({ id: "2", date: "2026-07-29" }),
      ],
      "2026-07-30",
      0.07,
      0.11,
      0.5,
    );
    assert.equal(board.mode, "today");
    assert.equal(board.sized.length, 1);
    assert.equal(board.pending.length, 0);
  });

  it("falls back to pending with empty sized", () => {
    const board = partitionBoard(
      [
        baseGame({
          predicted_winner: null,
          predicted_margin: null,
        }),
      ],
      "2026-07-30",
      0.07,
      0.11,
      0.5,
    );
    assert.equal(board.mode, "pending");
    assert.equal(board.pending.length, 1);
    assert.equal(board.sized.length, 0);
  });

  it("returns empty with both arrays empty", () => {
    const board = partitionBoard([], "2026-07-30", 0.07, 0.11, 0.5);
    assert.equal(board.mode, "empty");
    assert.equal(board.sized.length, 0);
    assert.equal(board.pending.length, 0);
  });

  it("recent mode keeps pending empty", () => {
    const board = partitionBoard(
      [baseGame({ date: "2026-07-29" })],
      "2026-07-30",
      0.07,
      0.11,
      0.5,
    );
    assert.equal(board.mode, "recent");
    assert.ok(board.sized.length > 0);
    assert.equal(board.pending.length, 0);
  });
});

describe("boardCopyForMode", () => {
  it("does not call pending tomorrow", () => {
    const copy = boardCopyForMode("pending", {
      sizedCount: 0,
      pendingCount: 3,
      multiplier: 0.5,
    });
    assert.equal(copy.title, "Sims still running");
    assert.doesNotMatch(copy.title.toLowerCase(), /tomorrow/);
    assert.doesNotMatch(copy.blurb.toLowerCase(), /tomorrow/);
  });

  it("covers every BoardMode", () => {
    for (const mode of ["today", "recent", "pending", "empty"] as const) {
      const copy = boardCopyForMode(mode, {
        sizedCount: 2,
        pendingCount: 1,
        multiplier: 0.5,
      });
      assert.ok(copy.title.length > 0);
      assert.ok(copy.blurb.length > 0);
    }
  });
});
