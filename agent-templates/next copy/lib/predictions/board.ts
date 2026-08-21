import { formatNyDate, todayInNewYork } from "./dates";
import {
  DEFAULT_ELO_CONFIG,
  buildEloSeason,
  preGameForMatch,
  type EloConfig,
  type EloPreGame,
  type EloTeamRating,
} from "./elo";
import {
  gameSelectList,
  resolveModelBetas,
  resolveOuBetas,
  type MlbGame,
  type ModelParamsRow,
  type TeamStatsRow,
} from "./schema";
import { createPublishableClient } from "@/lib/supabase/adapter";

export interface PredictionsBoard {
  today: string;
  fittedLabel: string | null;
  games: MlbGame[];
  model: ModelParamsRow | null;
  teamStats: TeamStatsRow[];
  b0: number;
  b1: number;
  ouB0: number;
  ouB1: number;
  elo: {
    config: EloConfig;
    standings: EloTeamRating[];
    /** Pre-game Elo keyed by mlb_predictions.id for board games. */
    preGameById: Record<string, EloPreGame>;
  };
}

type EloGameRow = {
  id: string;
  date: string;
  away_team: string;
  home_team: string;
  actual_winner_team: string | null;
};

async function fetchEloGameRows(
  supabase: ReturnType<typeof createPublishableClient>,
): Promise<EloGameRow[]> {
  const pageSize = 1000;
  const rows: EloGameRow[] = [];

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("mlb_predictions")
      .select("id,date,away_team,home_team,actual_winner_team")
      .order("date", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    rows.push(...(data as EloGameRow[]));
    if (data.length < pageSize) break;
  }
  return rows;
}

/**
 * Deep board loader: fetch + NY calendar day + resolved model betas + Elo.
 * Slate partitioning / Kelly sizing stay pure in size-game.ts.
 */
export async function loadBoard(limit = 50): Promise<PredictionsBoard> {
  const supabase = createPublishableClient();
  const today = todayInNewYork();

  const [gamesRes, modelRes, teamsRes, eloRows] = await Promise.all([
    supabase
      .from("mlb_predictions")
      .select(gameSelectList())
      .order("date", { ascending: false })
      .limit(limit),
    supabase
      .from("model_params")
      .select("*")
      .order("generated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from("team_stats").select("*").order("brier_score", { ascending: true }),
    fetchEloGameRows(supabase),
  ]);

  if (gamesRes.error) throw new Error(gamesRes.error.message);
  if (modelRes.error) throw new Error(modelRes.error.message);
  if (teamsRes.error) throw new Error(teamsRes.error.message);

  const model = (modelRes.data as unknown as ModelParamsRow | null) ?? null;
  const { b0, b1 } = resolveModelBetas(model);
  const { ouB0, ouB1 } = resolveOuBetas(model);
  const games = (gamesRes.data ?? []) as unknown as MlbGame[];

  const season = buildEloSeason(eloRows, DEFAULT_ELO_CONFIG);
  const preGameById: Record<string, EloPreGame> = {};
  for (const g of games) {
    if (season.preGame.has(g.id)) {
      preGameById[g.id] = season.preGame.get(g.id)!;
    } else {
      preGameById[g.id] = preGameForMatch(season, g);
    }
  }

  return {
    today,
    fittedLabel: model?.generated_at ? formatNyDate(model.generated_at) : null,
    games,
    model,
    teamStats: (teamsRes.data ?? []) as unknown as TeamStatsRow[],
    b0,
    b1,
    ouB0,
    ouB1,
    elo: {
      config: season.config,
      standings: season.standings,
      preGameById,
    },
  };
}
