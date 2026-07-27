import * as fs from "fs/promises";
import * as path from "path";
import { fileURLToPath } from "url";
import postgres from "postgres";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Interface representing the raw prediction parsed from Firecrawl Markdown
interface RawGame {
  date: string;
  awayTeam: string;
  homeTeam: string;
  awayPitcher: string;
  homePitcher: string;
  ml: string;
  spd: string;
  ou: string;
  predictedWinner: string;
  predictedScore: string;
  actualResult: string;
  pickResult: string;
}

// Interface representing the cleaned record to be inserted into Postgres
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
  actualWinner: number | null; // 1 if home won, 0 if away won
  actualMargin: number | null; // Away Score - Home Score
  actualTotalScore: number | null;
  winnerPickCorrect: boolean;
  marginPickCorrect: boolean;
  spreadPickCorrect: boolean;
}

// Cleaning helpers matching clean_predictions.ts
function calculateImpliedProbability(ml: number): number {
  if (isNaN(ml)) return 0;
  if (ml < 0) {
    return Math.abs(ml) / (Math.abs(ml) + 100);
  } else {
    return 100 / (ml + 100);
  }
}

function parseMoneyline(mlStr: string): { awayML: number | null; homeML: number | null } {
  if (!mlStr || typeof mlStr !== "string") {
    return { awayML: null, homeML: null };
  }
  let cleanStr = mlStr.replace(/^ML:\s*/i, "").trim();
  if (!cleanStr) return { awayML: null, homeML: null };

  const parts = cleanStr.split("/").map(s => s.trim());
  if (parts.length === 2) {
    const awayML = parseInt(parts[0], 10);
    const homeML = parseInt(parts[1], 10);
    return {
      awayML: isNaN(awayML) ? null : awayML,
      homeML: isNaN(homeML) ? null : homeML,
    };
  } else if (parts.length === 1) {
    const singleML = parseInt(parts[0], 10);
    if (!isNaN(singleML)) {
      return { awayML: singleML, homeML: singleML };
    }
  }
  return { awayML: null, homeML: null };
}

function parseSpread(spdStr: string): { awaySpread: number | null; homeSpread: number | null } {
  if (!spdStr || typeof spdStr !== "string") {
    return { awaySpread: null, homeSpread: null };
  }
  let cleanStr = spdStr.replace(/^Spd:\s*/i, "").trim();
  if (!cleanStr) return { awaySpread: null, homeSpread: null };

  const parsed = parseFloat(cleanStr);
  if (isNaN(parsed)) return { awaySpread: null, homeSpread: null };

  return {
    awaySpread: parsed,
    homeSpread: -parsed,
  };
}

function parseOverUnder(ouStr: string): number | null {
  if (!ouStr || typeof ouStr !== "string") return null;
  let cleanStr = ouStr.replace(/^O\/U:\s*/i, "").trim();
  if (!cleanStr) return null;

  const parsed = parseFloat(cleanStr);
  return isNaN(parsed) ? null : parsed;
}

function cleanRawGames(games: RawGame[]): CleanedGame[] {
  const cleaned: CleanedGame[] = [];

  for (const game of games) {
    if (!game.date) continue;

    const dateObj = new Date(`${game.date}T12:00:00Z`);
    const year = dateObj.getUTCFullYear();
    const month = dateObj.getUTCMonth() + 1;
    const day = dateObj.getUTCDate();
    const dayOfWeek = dateObj.getUTCDay();

    const awayTeam = game.awayTeam?.trim() || "";
    const homeTeam = game.homeTeam?.trim() || "";
    const awayPitcher = game.awayPitcher?.trim() || "";
    const homePitcher = game.homePitcher?.trim() || "";
    const predictedWinner = game.predictedWinner?.trim() || "";

    const { awayML, homeML } = parseMoneyline(game.ml);
    const awayImpliedProbability = awayML !== null ? calculateImpliedProbability(awayML) : null;
    const homeImpliedProbability = homeML !== null ? calculateImpliedProbability(homeML) : null;

    const { awaySpread, homeSpread } = parseSpread(game.spd);
    const overUnderLine = parseOverUnder(game.ou);

    let predictedAwayScore: number | null = null;
    let predictedHomeScore: number | null = null;
    let predictedWinnerScore: number | null = null;
    let predictedLoserScore: number | null = null;
    let predictedMargin: number | null = null;
    let predictedTotal: number | null = null;

    if (game.predictedScore && game.predictedScore.includes("-")) {
      const predParts = game.predictedScore.split("-").map(s => parseFloat(s.trim()));
      if (predParts.length === 2 && !isNaN(predParts[0]) && !isNaN(predParts[1])) {
        predictedWinnerScore = predParts[0];
        predictedLoserScore = predParts[1];
        predictedMargin = Math.abs(predictedWinnerScore - predictedLoserScore);
        predictedTotal = predictedWinnerScore + predictedLoserScore;

        if (predictedWinner === awayTeam) {
          predictedAwayScore = predictedWinnerScore;
          predictedHomeScore = predictedLoserScore;
        } else if (predictedWinner === homeTeam) {
          predictedAwayScore = predictedLoserScore;
          predictedHomeScore = predictedWinnerScore;
        }
      }
    }

    let actualAwayScore: number | null = null;
    let actualHomeScore: number | null = null;
    let actualWinnerTeam: string | null = null;
    let actualWinner: number | null = null;
    let actualMargin: number | null = null;
    let actualTotalScore: number | null = null;

    if (game.actualResult && game.actualResult.includes("wins")) {
      const actualMatch = game.actualResult.match(/^(.+?)\s+wins\s+(\d+)-(\d+)$/i);
      if (actualMatch) {
        actualWinnerTeam = actualMatch[1].trim();
        const winnerScore = parseInt(actualMatch[2], 10);
        const loserScore = parseInt(actualMatch[3], 10);

        if (!isNaN(winnerScore) && !isNaN(loserScore)) {
          actualTotalScore = winnerScore + loserScore;

          if (actualWinnerTeam === awayTeam) {
            actualAwayScore = winnerScore;
            actualHomeScore = loserScore;
            actualWinner = 0;
          } else if (actualWinnerTeam === homeTeam) {
            actualAwayScore = loserScore;
            actualHomeScore = winnerScore;
            actualWinner = 1;
          }

          if (actualAwayScore !== null && actualHomeScore !== null) {
            actualMargin = actualAwayScore - actualHomeScore;
          }
        }
      }
    }

    const pickResult = game.pickResult || "";
    const winnerPickCorrect = pickResult.includes("Correct") && !pickResult.includes("Incorrect");
    const marginPickCorrect = pickResult.includes("Margin Hit");
    const spreadPickCorrect = pickResult.includes("Spread Hit");

    cleaned.push({
      date: game.date,
      year,
      month,
      day,
      dayOfWeek,
      awayTeam,
      homeTeam,
      awayPitcher,
      homePitcher,
      awayMoneyline: awayML,
      homeMoneyline: homeML,
      awayImpliedProbability,
      homeImpliedProbability,
      awaySpread,
      homeSpread,
      overUnderLine,
      predictedWinner,
      predictedAwayScore,
      predictedHomeScore,
      predictedWinnerScore,
      predictedLoserScore,
      predictedMargin,
      predictedTotal,
      actualAwayScore,
      actualHomeScore,
      actualWinnerTeam,
      actualWinner,
      actualMargin,
      actualTotalScore,
      winnerPickCorrect,
      marginPickCorrect,
      spreadPickCorrect,
    });
  }

  return cleaned;
}

// Parsing function to extract predictions from Firecrawl Markdown
function parsePredictionsMarkdown(markdown: string): RawGame[] {
  const games: RawGame[] = [];
  const matchupRegex = /!\[\]\(https:\/\/www\.mygamesim\.com\/images\/teamlogos\/MLB\/[^\)]+\)\[([^\]]+)\]\([^\)]+\)@\[([^\]]+)\]\([^\)]+\)!\[\]\(https:\/\/www\.mygamesim\.com\/images\/teamlogos\/MLB\/[^\)]+\)/g;
  
  const matches: { index: number; text: string; awayTeam: string; homeTeam: string }[] = [];
  let match;
  while ((match = matchupRegex.exec(markdown)) !== null) {
    matches.push({
      index: match.index,
      text: match[0],
      awayTeam: match[1],
      homeTeam: match[2]
    });
  }

  for (let i = 0; i < matches.length; i++) {
    const current = matches[i];
    const startIndex = current.index + current.text.length;
    const endIndex = i < matches.length - 1 ? matches[i + 1].index : markdown.length;
    const block = markdown.slice(startIndex, endIndex);

    const lines = block.split("\n").map(l => l.trim()).filter(Boolean);
    
    const pitcherLine = lines.find(l => l.includes(" vs "));
    let awayPitcher = "";
    let homePitcher = "";
    if (pitcherLine) {
      const parts = pitcherLine.split(" vs ");
      awayPitcher = parts[0]?.trim() || "";
      homePitcher = parts[1]?.trim() || "";
    }

    const oddsLine = lines.find(l => l.startsWith("ML:"));
    let ml = "";
    let spd = "";
    let ou = "";
    if (oddsLine) {
      const mlMatch = oddsLine.match(/ML:\s*([^\sSpd]+)/);
      const spdMatch = oddsLine.match(/Spd:\s*([^\sO\/U]+)/);
      const ouMatch = oddsLine.match(/O\/U:\s*([^\s]+)/);
      if (mlMatch) ml = mlMatch[1];
      if (spdMatch) spd = spdMatch[1];
      if (ouMatch) ou = ouMatch[1];
    }

    let predictedWinner = "";
    let predictedScore = "";
    const predIdx = lines.indexOf("Prediction");
    if (predIdx !== -1 && predIdx < lines.length - 2) {
      const winnerLine = lines[predIdx + 1];
      const winScoreLine = lines[predIdx + 2];
      if (winnerLine.startsWith("**") && winnerLine.endsWith("**")) {
        predictedWinner = winnerLine.slice(2, -2).trim();
      }
      if (winScoreLine.startsWith("WIN ")) {
        predictedScore = winScoreLine.replace("WIN ", "").trim();
      }
    }

    let actualResult = "";
    const actualIdx = lines.indexOf("Actual / Pick");
    if (actualIdx !== -1 && actualIdx < lines.length - 1) {
      actualResult = lines[actualIdx + 1];
    }

    let pickResult = "";
    const resultIdx = lines.indexOf("Result");
    if (resultIdx !== -1 && resultIdx < lines.length - 1) {
      const resLine = lines[resultIdx + 1];
      if (resLine.startsWith("Pick: ")) {
        pickResult = resLine.replace("Pick: ", "").trim();
      }
    }

    games.push({
      date: "", // Will be assigned by the caller
      awayTeam: current.awayTeam,
      homeTeam: current.homeTeam,
      awayPitcher,
      homePitcher,
      ml,
      spd,
      ou,
      predictedWinner,
      predictedScore,
      actualResult,
      pickResult
    });
  }

  return games;
}

// Scrape a specific date using Firecrawl API
async function scrapeDate(date: string, apiKey: string): Promise<RawGame[]> {
  const url = `https://www.mygamesim.com/mlb/mlb-predictions.asp?dtGame=${date}`;
  console.log(`Scraping MLB predictions for: ${date}`);
  
  const response = await fetch("https://api.firecrawl.dev/v2/scrape", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      url,
      formats: ["markdown"],
      onlyMainContent: true,
      removeBase64Images: true,
      blockAds: true,
      profile: {
        name: "mygamesim-session"
      }
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Firecrawl API error: ${response.status} - ${text}`);
  }

  const resJson = (await response.json()) as any;
  const markdown = resJson.data?.markdown || "";
  
  if (!markdown) {
    console.log(`No markdown content found for ${date}`);
    return [];
  }

  const rawGames = parsePredictionsMarkdown(markdown);
  for (const game of rawGames) {
    game.date = date;
  }
  return rawGames;
}

// Format date helper (YYYY-MM-DD)
function formatDate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

async function run() {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    console.error("CRITICAL: FIRECRAWL_API_KEY is not defined in the environment.");
    process.exit(1);
  }

  const dbUrl = process.env.SUPABASE_DATABASE_URL;
  if (!dbUrl) {
    console.error("\nCRITICAL CONFIGURATION ERROR:");
    console.error("SUPABASE_DATABASE_URL is missing in your environment/dotenv file.");
    console.error("Please add the direct Postgres connection string to your .env file:");
    console.error("SUPABASE_DATABASE_URL=postgresql://postgres:[PASSWORD]@db.gwvtpzjzrakggdbiwlyw.supabase.co:5432/postgres\n");
    process.exit(1);
  }

  // Parse command line arguments
  const args = process.argv.slice(2);
  let datesToScrape: string[] = [];

  const dateArgIdx = args.indexOf("--date");
  const daysArgIdx = args.indexOf("--days");

  if (dateArgIdx !== -1 && dateArgIdx + 1 < args.length) {
    // Single specific date
    datesToScrape.push(args[dateArgIdx + 1]);
  } else {
    // Default to scanning last N days (yesterday and today)
    let daysToScan = 2;
    if (daysArgIdx !== -1 && daysArgIdx + 1 < args.length) {
      daysToScan = parseInt(args[daysArgIdx + 1], 10) || 2;
    }

    // Get dates in Eastern Time context (since MLB schedules operate on Eastern Time)
    const easternTime = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
    for (let i = 0; i < daysToScan; i++) {
      const d = new Date(easternTime);
      d.setDate(easternTime.getDate() - i);
      datesToScrape.push(formatDate(d));
    }
    // Reverse so we scrape older date first
    datesToScrape.reverse();
  }

  console.log(`Starting MLB Daily prediction pipeline for dates: ${datesToScrape.join(", ")}`);

  // Initialize direct database connection
  console.log("Connecting to Supabase Postgres database...");
  const sql = postgres(dbUrl, {
    ssl: "require",
    connect_timeout: 10,
  });

  try {
    for (const date of datesToScrape) {
      try {
        const rawGames = await scrapeDate(date, apiKey);
        if (rawGames.length === 0) {
          console.log(`No games scheduled or scraped for date: ${date}`);
          continue;
        }

        console.log(`Scraped ${rawGames.length} raw games. Parsing and cleaning...`);
        const cleanedGames = cleanRawGames(rawGames);

        console.log(`Syncing ${cleanedGames.length} games to database...`);
        let insertedCount = 0;

        for (const game of cleanedGames) {
          // SQL Upsert utilizing the unique constraint uq_game_date_teams
          await sql`
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
          insertedCount++;
        }

        console.log(`Successfully upserted ${insertedCount} games for ${date} to Supabase!`);
      } catch (err: any) {
        console.error(`Error processing date ${date}:`, err.message || err);
      }
      
      // Rate limit polite delay between dates
      if (datesToScrape.indexOf(date) < datesToScrape.length - 1) {
        console.log("Sleeping for 1.5 seconds to respect rate limits...");
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
    }
  } finally {
    // Always close the database connection cleanly
    await sql.end();
    console.log("Database connection closed.");
  }
}

run().catch((err) => {
  console.error("Cron script crash:", err);
  process.exit(1);
});
