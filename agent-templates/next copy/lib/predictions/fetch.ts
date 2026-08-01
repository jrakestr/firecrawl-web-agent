/**
 * Compatibility re-exports. Prefer loadBoard() from ./board for new code.
 */
export type {
  MlbGame,
  ModelParamsRow,
  TeamStatsRow,
  MlbPredictionRow,
} from "./schema";
export { loadBoard } from "./board";
export type { PredictionsBoard } from "./board";

import { loadBoard } from "./board";
import type { MlbGame, ModelParamsRow, TeamStatsRow } from "./schema";

export interface PredictionsPayload {
  games: MlbGame[];
  model: ModelParamsRow | null;
  teamStats: TeamStatsRow[];
}

/** @deprecated Prefer loadBoard */
export async function fetchPredictionsPayload(
  limit = 50,
): Promise<PredictionsPayload> {
  const board = await loadBoard(limit);
  return {
    games: board.games,
    model: board.model,
    teamStats: board.teamStats,
  };
}
