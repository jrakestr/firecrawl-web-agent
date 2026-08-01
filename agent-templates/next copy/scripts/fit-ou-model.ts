/**
 * One-shot: fit ML + OU logistics and insert into model_params.
 * Usage: node --import tsx scripts/fit-ou-model.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { runBacktest } from "../lib/backtest";
import { backtestSelectList } from "../lib/predictions/schema";

async function main() {
  const envPath = join(__dirname, "..", ".env.local");
  const env = Object.fromEntries(
    readFileSync(envPath, "utf8")
      .split("\n")
      .filter((l) => l && !l.startsWith("#") && l.includes("="))
      .map((l) => {
        const i = l.indexOf("=");
        return [l.slice(0, i), l.slice(i + 1)];
      }),
  );

  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("Missing SUPABASE_URL / SUPABASE_SECRET_KEY");

  const sb = createClient(url, key);
  const pageSize = 1000;
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    const { data, error } = await sb
      .from("mlb_predictions")
      .select(backtestSelectList())
      .not("actual_winner_team", "is", null)
      .order("date", { ascending: true })
      .range(from, to);
    if (error) throw error;
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < pageSize) break;
  }
  console.log(`Loaded ${rows.length} settled games`);

  const result = runBacktest(rows as Parameters<typeof runBacktest>[0]);
  const summary = {
    b0: result.b0,
    b1: result.b1,
    metrics: result.metrics,
    ou: result.ou
      ? {
          b0: result.ou.b0,
          b1: result.ou.b1,
          totalGames: result.ou.totalGames,
          accuracy: result.ou.accuracy,
          oosAccuracy: result.ou.oosAccuracy,
          skillScore: result.ou.skillScore,
          oosSkillScore: result.ou.oosSkillScore,
          trainEndDate: result.ou.trainEndDate,
          testStartDate: result.ou.testStartDate,
          calibration: result.ou.calibration,
        }
      : null,
  };
  console.log(JSON.stringify(summary, null, 2));

  const ouNote = result.ou
    ? ` ouAcc=${result.ou.accuracy.toFixed(4)} ouOos=${result.ou.oosAccuracy.toFixed(4)} ouSkill=${result.ou.skillScore.toFixed(4)}`
    : " ou=skipped";

  const { error: insertError } = await sb.from("model_params").insert({
    b0: result.b0,
    b1: result.b1,
    total_games: result.metrics.totalGames,
    accuracy: result.metrics.accuracy,
    log_loss_model: result.metrics.logLossModel,
    log_loss_baseline: result.metrics.logLossBaseline,
    skill_score: result.metrics.skillScore,
    calibration: result.calibration,
    team_stats: result.teamStats,
    train_end_date: result.trainEndDate,
    test_start_date: result.testStartDate,
    ou_model: result.ou,
    notes: `Retrain+OU: train=${result.metrics.trainGames} test=${result.metrics.testGames} oosAcc=${result.metrics.oosAccuracy.toFixed(4)} oosSkill=${result.metrics.oosSkillScore.toFixed(4)}${ouNote}`,
  });
  if (insertError) throw insertError;
  console.log("Inserted model_params with ou_model");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
