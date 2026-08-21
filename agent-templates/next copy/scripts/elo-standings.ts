/**
 * Print current season Elo standings from mlb_predictions.
 * Usage: node --import tsx scripts/elo-standings.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  DEFAULT_ELO_CONFIG,
  buildEloSeason,
} from "../lib/predictions/elo";

async function main() {
  const env = Object.fromEntries(
    readFileSync(join(__dirname, "..", ".env.local"), "utf8")
      .split("\n")
      .filter((l) => l && !l.startsWith("#") && l.includes("="))
      .map((l) => {
        const i = l.indexOf("=");
        return [l.slice(0, i), l.slice(i + 1)];
      }),
  );
  const sb = createClient(env.SUPABASE_URL!, env.SUPABASE_SECRET_KEY!);
  const rows: {
    id: string;
    date: string;
    away_team: string;
    home_team: string;
    actual_winner_team: string | null;
  }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from("mlb_predictions")
      .select("id,date,away_team,home_team,actual_winner_team")
      .order("date", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + 999);
    if (error) throw error;
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < 1000) break;
  }

  const season = buildEloSeason(rows, DEFAULT_ELO_CONFIG);
  console.log(
    JSON.stringify(
      {
        gamesWalked: rows.length,
        teams: season.standings.length,
        k: season.config.k,
        homeAdvantage: season.config.homeAdvantage,
        top10: season.standings.slice(0, 10).map((t) => ({
          team: t.team,
          elo: Math.round(t.elo),
          games: t.games,
        })),
        bottom5: season.standings.slice(-5).map((t) => ({
          team: t.team,
          elo: Math.round(t.elo),
          games: t.games,
        })),
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
