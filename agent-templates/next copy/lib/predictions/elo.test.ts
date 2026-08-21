import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_ELO,
  DEFAULT_ELO_K,
  buildEloSeason,
  eloExpectedScore,
  eloUpdate,
  preGameForMatch,
} from "./elo";

describe("eloExpectedScore", () => {
  it("is 0.5 for equal ratings", () => {
    assert.equal(eloExpectedScore(1500, 1500), 0.5);
  });

  it("favors the higher rating", () => {
    const p = eloExpectedScore(1600, 1500);
    assert.ok(p > 0.5);
    assert.ok(p < 1);
  });
});

describe("eloUpdate", () => {
  it("moves winner up and loser down by K-scaled surprise", () => {
    const { ratingA, ratingB } = eloUpdate(1500, 1500, 1, 20);
    assert.equal(ratingA, 1510);
    assert.equal(ratingB, 1490);
  });

  it("moves less when the favorite wins", () => {
    const upset = eloUpdate(1400, 1600, 1, 20); // underdog A wins
    const chalk = eloUpdate(1600, 1400, 1, 20); // favorite A wins
    assert.ok(upset.ratingA - 1400 > chalk.ratingA - 1600);
  });
});

describe("buildEloSeason", () => {
  it("starts everyone near the initial rating and applies K", () => {
    const season = buildEloSeason(
      [
        {
          id: "1",
          date: "2026-03-25",
          away_team: "Away",
          home_team: "Home",
          actual_winner_team: "Home",
        },
        {
          id: "2",
          date: "2026-03-26",
          away_team: "Away",
          home_team: "Home",
          actual_winner_team: "Home",
        },
      ],
      { initial: DEFAULT_ELO, k: DEFAULT_ELO_K, homeAdvantage: 0 },
    );

    assert.ok((season.ratings.get("Home") ?? 0) > DEFAULT_ELO);
    assert.ok((season.ratings.get("Away") ?? 0) < DEFAULT_ELO);
    assert.equal(season.standings[0]?.team, "Home");
    assert.equal(season.preGame.get("1")?.pHome, 0.5);
  });

  it("records pre-game Elo before applying the result", () => {
    const season = buildEloSeason(
      [
        {
          id: "a",
          date: "2026-04-01",
          away_team: "A",
          home_team: "B",
          actual_winner_team: "A",
        },
      ],
      { initial: 1500, k: 20, homeAdvantage: 0 },
    );
    const pre = season.preGame.get("a");
    assert.ok(pre);
    assert.equal(pre!.awayElo, 1500);
    assert.equal(pre!.homeElo, 1500);
    assert.notEqual(season.ratings.get("A"), 1500);
  });

  it("skips rating updates when winner is not away/home", () => {
    const season = buildEloSeason(
      [
        {
          id: "bad",
          date: "2026-04-01",
          away_team: "A",
          home_team: "B",
          actual_winner_team: "Emmet Sheehan",
        },
      ],
      { initial: 1500, k: 20, homeAdvantage: 24 },
    );
    assert.equal(season.ratings.get("A"), 1500);
    assert.equal(season.ratings.get("B"), 1500);
    assert.equal(season.standings.length, 0);
  });

  it("throws on non-positive K", () => {
    assert.throws(() =>
      buildEloSeason([], { initial: 1500, k: 0, homeAdvantage: 0 }),
    );
  });
});

describe("preGameForMatch", () => {
  it("falls back to current ratings when id is unknown", () => {
    const season = buildEloSeason(
      [
        {
          id: "1",
          date: "2026-04-01",
          away_team: "A",
          home_team: "B",
          actual_winner_team: "A",
        },
      ],
      { initial: 1500, k: 20, homeAdvantage: 0 },
    );
    const pre = preGameForMatch(season, {
      id: "future",
      away_team: "A",
      home_team: "B",
    });
    assert.equal(pre.awayElo, season.ratings.get("A"));
    assert.equal(pre.homeElo, season.ratings.get("B"));
  });
});
