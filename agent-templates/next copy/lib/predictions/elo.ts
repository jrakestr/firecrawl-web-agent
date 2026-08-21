/**
 * Season Elo from actual game results (not sims).
 * Standard logistic: P(A beats B) = 1 / (1 + 10^((Rb − Ra) / 400)).
 * Home gets `homeAdvantage` Elo points before the expected-score calc.
 */

export const DEFAULT_ELO = 1500;
/** How hard each game moves the ratings. Higher = more reactive. */
export const DEFAULT_ELO_K = 20;
/** Home-field bump in Elo points (~54% home expect at equal teams). */
export const DEFAULT_ELO_HOME_ADVANTAGE = 24;

export interface EloConfig {
  initial: number;
  k: number;
  homeAdvantage: number;
}

export const DEFAULT_ELO_CONFIG: EloConfig = {
  initial: DEFAULT_ELO,
  k: DEFAULT_ELO_K,
  homeAdvantage: DEFAULT_ELO_HOME_ADVANTAGE,
};

export interface EloGameInput {
  id: string;
  date: string;
  away_team: string;
  home_team: string;
  /** Settled winner; null/undefined = not finished yet. */
  actual_winner_team: string | null | undefined;
}

export interface EloPreGame {
  awayElo: number;
  homeElo: number;
  /** P(home wins) with home-field advantage applied. */
  pHome: number;
  pAway: number;
}

export interface EloTeamRating {
  team: string;
  elo: number;
  games: number;
}

export interface EloSeasonResult {
  config: EloConfig;
  /** Ratings after every settled game in the walk. */
  ratings: Map<string, number>;
  gamesPlayed: Map<string, number>;
  /** Pre-game snapshot for every input game id (settled or not). */
  preGame: Map<string, EloPreGame>;
  standings: EloTeamRating[];
}

/** Expected score for ratingA vs ratingB (no home bump — caller applies it). */
export function eloExpectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + 10 ** ((ratingB - ratingA) / 400));
}

/**
 * Update both ratings after a decisive result.
 * scoreA = 1 win, 0 loss (draws not used for MLB).
 */
export function eloUpdate(
  ratingA: number,
  ratingB: number,
  scoreA: 0 | 1,
  k: number,
): { ratingA: number; ratingB: number } {
  const expectedA = eloExpectedScore(ratingA, ratingB);
  const expectedB = 1 - expectedA;
  const scoreB = (1 - scoreA) as 0 | 1;
  return {
    ratingA: ratingA + k * (scoreA - expectedA),
    ratingB: ratingB + k * (scoreB - expectedB),
  };
}

function ensureRating(
  ratings: Map<string, number>,
  team: string,
  initial: number,
): number {
  const existing = ratings.get(team);
  if (existing != null) return existing;
  ratings.set(team, initial);
  return initial;
}

function bumpGames(gamesPlayed: Map<string, number>, team: string): void {
  gamesPlayed.set(team, (gamesPlayed.get(team) ?? 0) + 1);
}

/**
 * Walk games in date order. For each game, record pre-game Elo, then if
 * settled with a winner matching away/home, apply the K update.
 */
export function buildEloSeason(
  games: readonly EloGameInput[],
  config: EloConfig = DEFAULT_ELO_CONFIG,
): EloSeasonResult {
  const { initial, k, homeAdvantage } = config;
  if (!(k > 0) || !Number.isFinite(k)) {
    throw new Error(`Elo K must be a positive finite number, got ${k}`);
  }

  const ratings = new Map<string, number>();
  const gamesPlayed = new Map<string, number>();
  const preGame = new Map<string, EloPreGame>();

  const ordered = [...games].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  for (const g of ordered) {
    const awayElo = ensureRating(ratings, g.away_team, initial);
    const homeElo = ensureRating(ratings, g.home_team, initial);
    const pHome = eloExpectedScore(homeElo + homeAdvantage, awayElo);
    const pAway = 1 - pHome;
    preGame.set(g.id, { awayElo, homeElo, pHome, pAway });

    const winner = g.actual_winner_team?.trim();
    if (!winner) continue;

    const away = g.away_team.trim().toLowerCase();
    const home = g.home_team.trim().toLowerCase();
    const w = winner.toLowerCase();
    let homeWon: boolean | null = null;
    if (w === home) homeWon = true;
    else if (w === away) homeWon = false;
    else continue; // scrape junk / mismatched names — skip rating update

    // Apply HFA only to the expectation used for the update, via shifted home rating.
    const homeForUpdate = homeElo + homeAdvantage;
    const updated = homeWon
      ? eloUpdate(homeForUpdate, awayElo, 1, k)
      : eloUpdate(homeForUpdate, awayElo, 0, k);

    // Strip HFA back off the stored home rating.
    ratings.set(g.home_team, updated.ratingA - homeAdvantage);
    ratings.set(g.away_team, updated.ratingB);
    bumpGames(gamesPlayed, g.away_team);
    bumpGames(gamesPlayed, g.home_team);
  }

  const standings: EloTeamRating[] = [...ratings.entries()]
    .map(([team, elo]) => ({
      team,
      elo,
      games: gamesPlayed.get(team) ?? 0,
    }))
    .filter((r) => r.games > 0)
    .sort((a, b) => b.elo - a.elo || a.team.localeCompare(b.team));

  return { config, ratings, gamesPlayed, preGame, standings };
}

/** Look up pre-game Elo for a board game; falls back to current ratings. */
export function preGameForMatch(
  season: EloSeasonResult,
  game: Pick<EloGameInput, "id" | "away_team" | "home_team">,
): EloPreGame {
  const hit = season.preGame.get(game.id);
  if (hit) return hit;

  const { initial, homeAdvantage } = season.config;
  const awayElo = season.ratings.get(game.away_team) ?? initial;
  const homeElo = season.ratings.get(game.home_team) ?? initial;
  const pHome = eloExpectedScore(homeElo + homeAdvantage, awayElo);
  return { awayElo, homeElo, pHome, pAway: 1 - pHome };
}
