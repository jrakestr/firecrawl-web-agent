import * as fs from "fs/promises";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

  // Strip ML prefix if present
  let cleanStr = mlStr.replace(/^ML:\s*/i, "").trim();
  if (!cleanStr) {
    return { awayML: null, homeML: null };
  }

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
  if (!cleanStr) {
    return { awaySpread: null, homeSpread: null };
  }

  const parsed = parseFloat(cleanStr);
  if (isNaN(parsed)) {
    return { awaySpread: null, homeSpread: null };
  }

  return {
    awaySpread: parsed,
    homeSpread: -parsed,
  };
}

function parseOverUnder(ouStr: string): number | null {
  if (!ouStr || typeof ouStr !== "string") {
    return null;
  }

  let cleanStr = ouStr.replace(/^O\/U:\s*/i, "").trim();
  if (!cleanStr) {
    return null;
  }

  const parsed = parseFloat(cleanStr);
  return isNaN(parsed) ? null : parsed;
}

function cleanPredictions(games: RawGame[]): CleanedGame[] {
  const cleaned: CleanedGame[] = [];

  for (const game of games) {
    if (!game.date) continue;

    // 1. Temporal Parsing
    const dateObj = new Date(`${game.date}T12:00:00Z`);
    const year = dateObj.getUTCFullYear();
    const month = dateObj.getUTCMonth() + 1;
    const day = dateObj.getUTCDate();
    const dayOfWeek = dateObj.getUTCDay();

    // 2. Team and Pitcher standardization
    const awayTeam = game.awayTeam?.trim() || "";
    const homeTeam = game.homeTeam?.trim() || "";
    const awayPitcher = game.awayPitcher?.trim() || "";
    const homePitcher = game.homePitcher?.trim() || "";
    const predictedWinner = game.predictedWinner?.trim() || "";

    // 3. Moneyline splitting
    const { awayML, homeML } = parseMoneyline(game.ml);
    const awayImpliedProbability = awayML !== null ? calculateImpliedProbability(awayML) : null;
    const homeImpliedProbability = homeML !== null ? calculateImpliedProbability(homeML) : null;

    // 4. Spread and O/U
    const { awaySpread, homeSpread } = parseSpread(game.spd);
    const overUnderLine = parseOverUnder(game.ou);

    // 5. Prediction Score Mapping
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

    // 6. Actual Outcome Mapping
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
            actualWinner = 0; // Away won
          } else if (actualWinnerTeam === homeTeam) {
            actualAwayScore = loserScore;
            actualHomeScore = winnerScore;
            actualWinner = 1; // Home won
          }

          if (actualAwayScore !== null && actualHomeScore !== null) {
            actualMargin = actualAwayScore - actualHomeScore;
          }
        }
      }
    }

    // 7. Pick Accuracy Deconstruction
    const pickResult = game.pickResult || "";
    // Note: pickResult might contain concatenated strings, we use robust string searching
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

function escapeCsvField(val: any): string {
  if (val === null || val === undefined) return "";
  const str = String(val);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function convertToCsv(data: CleanedGame[]): string {
  if (data.length === 0) return "";
  const headers = Object.keys(data[0]) as (keyof CleanedGame)[];
  const csvLines: string[] = [];

  // Header line
  csvLines.push(headers.join(","));

  // Data lines
  for (const row of data) {
    const values = headers.map(h => escapeCsvField(row[h]));
    csvLines.push(values.join(","));
  }

  return csvLines.join("\n");
}

async function main() {
  const jsonPath = path.join(__dirname, "../scraped_data/all_predictions_compiled.json");
  const csvPath = path.join(__dirname, "../scraped_data/mlb_predictions_cleaned.csv");
  const cleanedJsonPath = path.join(__dirname, "../scraped_data/mlb_predictions_cleaned.json");

  console.log(`Reading raw compiled dataset from: ${jsonPath}`);
  let rawContent: string;
  try {
    rawContent = await fs.readFile(jsonPath, "utf-8");
  } catch (err: any) {
    console.error(`Error reading raw compiled file: ${err.message}`);
    process.exit(1);
  }

  const rawData = JSON.parse(rawContent);
  const games: RawGame[] = rawData.predictions || [];
  console.log(`Loaded ${games.length} raw game predictions. Cleaning...`);

  const cleanedGames = cleanPredictions(games);
  console.log(`Successfully cleaned and mapped ${cleanedGames.length} games.`);

  // Write Cleaned JSON
  await fs.writeFile(cleanedJsonPath, JSON.stringify(cleanedGames, null, 2), "utf-8");
  console.log(`Cleaned JSON written to: ${cleanedJsonPath}`);

  // Write CSV
  const csvContent = convertToCsv(cleanedGames);
  await fs.writeFile(csvPath, csvContent, "utf-8");
  console.log(`Cleaned CSV written to: ${csvPath}`);

  // Log some useful statistics for verification
  const totalGamesWithActuals = cleanedGames.filter(g => g.actualWinner !== null).length;
  const correctWinners = cleanedGames.filter(g => g.actualWinner !== null && g.winnerPickCorrect).length;
  const correctMargins = cleanedGames.filter(g => g.actualWinner !== null && g.marginPickCorrect).length;
  const correctSpreads = cleanedGames.filter(g => g.actualWinner !== null && g.spreadPickCorrect).length;

  console.log("\n--- Validation & Statistics Summary ---");
  console.log(`Total Games Cleaned: ${cleanedGames.length}`);
  console.log(`Games with Finished Actual Outcomes: ${totalGamesWithActuals}`);
  if (totalGamesWithActuals > 0) {
    console.log(`Winner Prediction Accuracy: ${((correctWinners / totalGamesWithActuals) * 100).toFixed(2)}% (${correctWinners}/${totalGamesWithActuals})`);
    console.log(`Exact Margin Hit Accuracy: ${((correctMargins / totalGamesWithActuals) * 100).toFixed(2)}% (${correctMargins}/${totalGamesWithActuals})`);
    console.log(`Spread Hit Accuracy: ${((correctSpreads / totalGamesWithActuals) * 100).toFixed(2)}% (${correctSpreads}/${totalGamesWithActuals})`);
  }
}

main().catch(console.error);
