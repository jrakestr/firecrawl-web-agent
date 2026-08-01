import { NextResponse } from "next/server";
import { runBacktest, type MlbPredictionRow } from "@/lib/backtest";
import { backtestSelectList } from "@/lib/predictions/schema";
import {
  authorizeRetrain,
  createSecretClient,
  refreshTeamStats,
} from "@/lib/supabase/adapter";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  const auth = await authorizeRetrain(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  try {
    const supabase = createSecretClient();

    const pageSize = 1000;
    const games: MlbPredictionRow[] = [];
    for (let from = 0; ; from += pageSize) {
      const to = from + pageSize - 1;
      const { data, error } = await supabase
        .from("mlb_predictions")
        .select(backtestSelectList())
        .not("actual_winner_team", "is", null)
        .order("date", { ascending: true })
        .range(from, to);
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      if (!data?.length) break;
      games.push(...(data as unknown as MlbPredictionRow[]));
      if (data.length < pageSize) break;
    }

    const result = runBacktest(games);

    const ouNote = result.ou
      ? ` ouAcc=${result.ou.accuracy.toFixed(4)} ouOos=${result.ou.oosAccuracy.toFixed(4)} ouSkill=${result.ou.skillScore.toFixed(4)}`
      : " ou=skipped";

    const { error: insertError } = await supabase.from("model_params").insert({
      b0: result.b0,
      b1: result.b1,
      total_games: result.metrics.totalGames,
      accuracy: result.metrics.accuracy,
      log_loss_model: result.metrics.logLossModel,
      log_loss_baseline: result.metrics.logLossBaseline,
      skill_score: result.metrics.skillScore,
      calibration: result.calibration,
      // Snapshot kept for audit; standings UI reads the team_stats MV.
      team_stats: result.teamStats,
      train_end_date: result.trainEndDate,
      test_start_date: result.testStartDate,
      ou_model: result.ou,
      notes: `Retrain: train=${result.metrics.trainGames} test=${result.metrics.testGames} oosAcc=${result.metrics.oosAccuracy.toFixed(4)} oosSkill=${result.metrics.oosSkillScore.toFixed(4)}${ouNote}`,
    });

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    const refreshed = await refreshTeamStats(supabase);
    if (!refreshed.ok) {
      console.warn("refresh_team_stats failed:", refreshed.message);
    }

    return NextResponse.json({
      success: true,
      b0: result.b0,
      b1: result.b1,
      ou: result.ou,
      authMode: auth.authMode,
      teamStatsRefreshed: refreshed.ok,
      ...result.metrics,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
