import * as fs from "fs/promises";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface CleanedGame {
  date: string;
  year: number;
  month: number;
  day: number;
  dayOfWeek: number;
  awayTeam: string;
  homeTeam: string;
  awayPitcher: string;
  homePitcher: string;
  awayMoneyline: number | null;
  homeMoneyline: number | null;
  awayImpliedProbability: number | null;
  homeImpliedProbability: number | null;
  awaySpread: number | null;
  homeSpread: number | null;
  overUnderLine: number | null;
  predictedWinner: string;
  predictedAwayScore: number | null;
  predictedHomeScore: number | null;
  predictedWinnerScore: number | null;
  predictedLoserScore: number | null;
  predictedMargin: number | null;
  predictedTotal: number | null;
  actualAwayScore: number | null;
  actualHomeScore: number | null;
  actualWinnerTeam: string | null;
  actualWinner: number | null;
  actualMargin: number | null;
  actualTotalScore: number | null;
  winnerPickCorrect: boolean;
  marginPickCorrect: boolean;
  spreadPickCorrect: boolean;
}

function escapeSqlString(val: string | null | undefined): string {
  if (val === null || val === undefined) return "NULL";
  return `'${String(val).replace(/'/g, "''")}'`;
}

function sqlVal(val: any): string {
  if (val === null || val === undefined) return "NULL";
  if (typeof val === "boolean") return val ? "true" : "false";
  if (typeof val === "number") return isNaN(val) ? "NULL" : String(val);
  return escapeSqlString(val);
}

async function main() {
  const jsonPath = path.join(__dirname, "../scraped_data/mlb_predictions_cleaned.json");
  const rawData = await fs.readFile(jsonPath, "utf-8");
  const games = JSON.parse(rawData) as CleanedGame[];

  console.log(`Loaded ${games.length} games to generate SQL for.`);

  const batchSize = 200;
  for (let batchIdx = 0; batchIdx < Math.ceil(games.length / batchSize); batchIdx++) {
    const chunk = games.slice(batchIdx * batchSize, (batchIdx + 1) * batchSize);
    
    let sql = `INSERT INTO public.mlb_predictions (
      date, year, month, day, day_of_week,
      away_team, home_team, away_pitcher, home_pitcher,
      away_moneyline, home_moneyline,
      away_implied_probability, home_implied_probability,
      away_spread, home_spread, over_under_line,
      predicted_winner, predicted_away_score, predicted_home_score,
      predicted_winner_score, predicted_loser_score, predicted_margin, predicted_total,
      actual_away_score, actual_home_score, actual_winner_team, actual_winner,
      actual_margin, actual_total_score,
      winner_pick_correct, margin_pick_correct, spread_pick_correct
    ) VALUES\n`;

    const valueRows = chunk.map(game => {
      return `      (${sqlVal(game.date)}, ${sqlVal(game.year)}, ${sqlVal(game.month)}, ${sqlVal(game.day)}, ${sqlVal(game.dayOfWeek)},
       ${sqlVal(game.awayTeam)}, ${sqlVal(game.homeTeam)}, ${sqlVal(game.awayPitcher)}, ${sqlVal(game.homePitcher)},
       ${sqlVal(game.awayMoneyline)}, ${sqlVal(game.homeMoneyline)},
       ${sqlVal(game.awayImpliedProbability)}, ${sqlVal(game.homeImpliedProbability)},
       ${sqlVal(game.awaySpread)}, ${sqlVal(game.homeSpread)}, ${sqlVal(game.overUnderLine)},
       ${sqlVal(game.predictedWinner)}, ${sqlVal(game.predictedAwayScore)}, ${sqlVal(game.predictedHomeScore)},
       ${sqlVal(game.predictedWinnerScore)}, ${sqlVal(game.predictedLoserScore)}, ${sqlVal(game.predictedMargin)}, ${sqlVal(game.predictedTotal)},
       ${sqlVal(game.actualAwayScore)}, ${sqlVal(game.actualHomeScore)}, ${sqlVal(game.actualWinnerTeam)}, ${sqlVal(game.actualWinner)},
       ${sqlVal(game.actualMargin)}, ${sqlVal(game.actualTotalScore)},
       ${sqlVal(game.winnerPickCorrect)}, ${sqlVal(game.marginPickCorrect)}, ${sqlVal(game.spreadPickCorrect)})`;
    });

    sql += valueRows.join(",\n");
    sql += `\nON CONFLICT (date, away_team, home_team) DO UPDATE SET
      away_pitcher = EXCLUDED.away_pitcher,
      home_pitcher = EXCLUDED.home_pitcher,
      away_moneyline = EXCLUDED.away_moneyline,
      home_moneyline = EXCLUDED.home_moneyline,
      away_implied_probability = EXCLUDED.away_implied_probability,
      home_implied_probability = EXCLUDED.home_implied_probability,
      away_spread = EXCLUDED.away_spread,
      home_spread = EXCLUDED.home_spread,
      over_under_line = EXCLUDED.over_under_line,
      predicted_winner = EXCLUDED.predicted_winner,
      predicted_away_score = EXCLUDED.predicted_away_score,
      predicted_home_score = EXCLUDED.predicted_home_score,
      predicted_winner_score = EXCLUDED.predicted_winner_score,
      predicted_loser_score = EXCLUDED.predicted_loser_score,
      predicted_margin = EXCLUDED.predicted_margin,
      predicted_total = EXCLUDED.predicted_total,
      actual_away_score = EXCLUDED.actual_away_score,
      actual_home_score = EXCLUDED.actual_home_score,
      actual_winner_team = EXCLUDED.actual_winner_team,
      actual_winner = EXCLUDED.actual_winner,
      actual_margin = EXCLUDED.actual_margin,
      actual_total_score = EXCLUDED.actual_total_score,
      winner_pick_correct = EXCLUDED.winner_pick_correct,
      margin_pick_correct = EXCLUDED.margin_pick_correct,
      spread_pick_correct = EXCLUDED.spread_pick_correct,
      updated_at = timezone('utc'::text, now());`;

    const outPath = path.join(__dirname, `../scraped_data/batch_${batchIdx}.sql`);
    await fs.writeFile(outPath, sql, "utf-8");
    console.log(`Generated SQL file: ${outPath}`);
  }
}

main().catch(err => {
  console.error("Error generating SQL:", err);
  process.exit(1);
});
