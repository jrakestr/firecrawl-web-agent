import * as fs from "fs/promises";
import * as path from "path";
import { fileURLToPath } from "url";
import postgres from "postgres";

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

async function run() {
  const dbUrl = process.env.SUPABASE_DATABASE_URL;
  if (!dbUrl) {
    console.error("\nCRITICAL CONFIGURATION ERROR:");
    console.error("SUPABASE_DATABASE_URL is missing in your environment/dotenv file.");
    console.error("Please add the direct Postgres connection string to your .env file:");
    console.error("SUPABASE_DATABASE_URL=postgresql://postgres:[PASSWORD]@db.gwvtpzjzrakggdbiwlyw.supabase.co:5432/postgres\n");
    process.exit(1);
  }

  const jsonPath = path.join(__dirname, "../scraped_data/mlb_predictions_cleaned.json");
  console.log(`Reading cleaned historical dataset from: ${jsonPath}`);
  
  let data: CleanedGame[] = [];
  try {
    const rawContent = await fs.readFile(jsonPath, "utf-8");
    data = JSON.parse(rawContent) as CleanedGame[];
  } catch (err: any) {
    console.error(`Error reading ${jsonPath}:`, err.message || err);
    process.exit(1);
  }

  console.log(`Loaded ${data.length} historical game predictions. Initializing database sync...`);

  // Initialize direct database connection
  const sql = postgres(dbUrl, {
    ssl: "require",
    connect_timeout: 15,
  });

  try {
    console.log("Beginning transaction for batch historical upserts...");
    let successCount = 0;

    // We can insert in chunks of 100 rows for high performance and efficiency
    const CHUNK_SIZE = 100;
    for (let i = 0; i < data.length; i += CHUNK_SIZE) {
      const chunk = data.slice(i, i + CHUNK_SIZE);
      console.log(`Uploading chunk ${Math.floor(i / CHUNK_SIZE) + 1} of ${Math.ceil(data.length / CHUNK_SIZE)} (${chunk.length} games)...`);

      // We execute standard upserts within a promise chain
      await sql.begin(async (tx) => {
        for (const game of chunk) {
          await tx`
            insert into public.mlb_predictions (
              date, year, month, day, day_of_week,
              away_team, home_team, away_pitcher, home_pitcher,
              away_moneyline, home_moneyline,
              away_implied_probability, home_implied_probability,
              away_spread, home_spread, over_under_line,
              predicted_winner, predicted_away_score, predicted_home_score,
              predicted_winner_score, predicted_loser_score, predicted_margin, predicted_total,
              actual_away_score, actual_home_score, actual_winner_team, actual_winner,
              actual_margin, actual_total_score,
              winner_pick_correct, margin_pick_correct, spread_pick_correct,
              updated_at
            ) values (
              ${game.date}, ${game.year}, ${game.month}, ${game.day}, ${game.dayOfWeek},
              ${game.awayTeam}, ${game.homeTeam}, ${game.awayPitcher}, ${game.homePitcher},
              ${game.awayMoneyline}, ${game.homeMoneyline},
              ${game.awayImpliedProbability}, ${game.homeImpliedProbability},
              ${game.awaySpread}, ${game.homeSpread}, ${game.overUnderLine},
              ${game.predictedWinner}, ${game.predictedAwayScore}, ${game.predictedHomeScore},
              ${game.predictedWinnerScore}, ${game.predictedLoserScore}, ${game.predictedMargin}, ${game.predictedTotal},
              ${game.actualAwayScore}, ${game.actualHomeScore}, ${game.actualWinnerTeam}, ${game.actualWinner},
              ${game.actualMargin}, ${game.actualTotalScore},
              ${game.winnerPickCorrect}, ${game.marginPickCorrect}, ${game.spreadPickCorrect},
              timezone('utc'::text, now())
            )
            on conflict (date, away_team, home_team)
            do update set
              away_pitcher = excluded.away_pitcher,
              home_pitcher = excluded.home_pitcher,
              away_moneyline = excluded.away_moneyline,
              home_moneyline = excluded.home_moneyline,
              away_implied_probability = excluded.away_implied_probability,
              home_implied_probability = excluded.home_implied_probability,
              away_spread = excluded.away_spread,
              home_spread = excluded.home_spread,
              over_under_line = excluded.over_under_line,
              predicted_winner = excluded.predicted_winner,
              predicted_away_score = excluded.predicted_away_score,
              predicted_home_score = excluded.predicted_home_score,
              predicted_winner_score = excluded.predicted_winner_score,
              predicted_loser_score = excluded.predicted_loser_score,
              predicted_margin = excluded.predicted_margin,
              predicted_total = excluded.predicted_total,
              actual_away_score = excluded.actual_away_score,
              actual_home_score = excluded.actual_home_score,
              actual_winner_team = excluded.actual_winner_team,
              actual_winner = excluded.actual_winner,
              actual_margin = excluded.actual_margin,
              actual_total_score = excluded.actual_total_score,
              winner_pick_correct = excluded.winner_pick_correct,
              margin_pick_correct = excluded.margin_pick_correct,
              spread_pick_correct = excluded.spread_pick_correct,
              updated_at = timezone('utc'::text, now());
          `;
          successCount++;
        }
      });
    }

    console.log(`\nSUCCESS: Uploaded and synchronized all ${successCount} games successfully to Supabase!`);
  } catch (err: any) {
    console.error("Database upload error:", err.message || err);
    process.exit(1);
  } finally {
    await sql.end();
    console.log("Database connection cleanly closed.");
  }
}

run().catch((err) => {
  console.error("Historical upload script crash:", err);
  process.exit(1);
});
