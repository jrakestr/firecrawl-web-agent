import { formatNyDate, todayInNewYork } from "./dates";
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
}

/**
 * Deep board loader: fetch + NY calendar day + resolved model betas.
 * Slate partitioning / Kelly sizing stay pure in size-game.ts.
 */
export async function loadBoard(limit = 50): Promise<PredictionsBoard> {
  const supabase = createPublishableClient();
  const today = todayInNewYork();

  const [gamesRes, modelRes, teamsRes] = await Promise.all([
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
  ]);

  if (gamesRes.error) throw new Error(gamesRes.error.message);
  if (modelRes.error) throw new Error(modelRes.error.message);
  if (teamsRes.error) throw new Error(teamsRes.error.message);

  const model = (modelRes.data as unknown as ModelParamsRow | null) ?? null;
  const { b0, b1 } = resolveModelBetas(model);
  const { ouB0, ouB1 } = resolveOuBetas(model);

  return {
    today,
    fittedLabel: model?.generated_at ? formatNyDate(model.generated_at) : null,
    games: (gamesRes.data ?? []) as unknown as MlbGame[],
    model,
    teamStats: (teamsRes.data ?? []) as unknown as TeamStatsRow[],
    b0,
    b1,
    ouB0,
    ouB1,
  };
}
