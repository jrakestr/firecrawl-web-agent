import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  partitionBoard,
  sizeGame,
  sizeWhatIf,
} from "./size-game";
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
  it("prefers today's sized games", () => {
    const board = partitionBoard(
      [baseGame({ date: "2026-07-30" }), baseGame({ id: "2", date: "2026-07-29" })],
      "2026-07-30",
      0.07,
      0.11,
      0.5,
    );
    assert.equal(board.mode, "today");
    assert.equal(board.sized.length, 1);
  });

  it("falls back to pending when no predictions", () => {
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
  });
});
