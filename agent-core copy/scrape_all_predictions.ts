import * as fs from "fs/promises";
import * as path from "path";

// Helper to generate dates from 2026-03-25 to 2026-07-18
function generateDates(startStr: string, endStr: string): string[] {
  const start = new Date(`${startStr}T12:00:00Z`);
  const end = new Date(`${endStr}T12:00:00Z`);
  const dates: string[] = [];
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

interface ParsedGame {
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

function parsePredictions(markdown: string): ParsedGame[] {
  const games: ParsedGame[] = [];
  
  // Regex to match the matchup line: ![](...) [Away Team] (...) @ [Home Team] (...) ![](...)
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
    
    // Find pitcher matchup
    const pitcherLine = lines.find(l => l.includes(" vs "));
    let awayPitcher = "";
    let homePitcher = "";
    if (pitcherLine) {
      const parts = pitcherLine.split(" vs ");
      awayPitcher = parts[0]?.trim() || "";
      homePitcher = parts[1]?.trim() || "";
    }

    // Find odds
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

    // Find predictions
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

    // Find actual results
    let actualResult = "";
    const actualIdx = lines.indexOf("Actual / Pick");
    if (actualIdx !== -1 && actualIdx < lines.length - 1) {
      actualResult = lines[actualIdx + 1];
    }

    // Find pick results
    let pickResult = "";
    const resultIdx = lines.indexOf("Result");
    if (resultIdx !== -1 && resultIdx < lines.length - 1) {
      const resLine = lines[resultIdx + 1];
      if (resLine.startsWith("Pick: ")) {
        pickResult = resLine.replace("Pick: ", "").trim();
      }
    }

    games.push({
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

async function scrapeDate(date: string, apiKey: string, outDir: string): Promise<ParsedGame[]> {
  const url = `https://www.mygamesim.com/mlb/mlb-predictions.asp?dtGame=${date}`;
  
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
      maxAge: 31536000000, // 1 year cache age in ms
      profile: {
        name: "mygamesim-session"
      }
    })
  });

  if (!response.ok) {
    throw new Error(`Firecrawl API error: ${response.status} ${response.statusText}`);
  }

  const result = await response.json() as any;
  if (!result.success || !result.data?.markdown) {
    throw new Error(`Scrape unsuccessful or returned empty markdown for date ${date}`);
  }

  const markdown = result.data.markdown;
  
  // Save raw markdown for record keeping / inspection
  await fs.writeFile(path.join(outDir, `raw_markdown_${date}.md`), markdown, "utf-8");

  // Parse games
  const games = parsePredictions(markdown);
  return games;
}

async function main() {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    console.error("Error: FIRECRAWL_API_KEY is not set.");
    process.exit(1);
  }

  const dataDir = path.join(process.cwd(), "scraped_data");
  await fs.mkdir(dataDir, { recursive: true });

  const dates = generateDates("2026-03-25", "2026-07-18");
  console.log(`Starting MLB predictions scraping for ${dates.length} days (from ${dates[0]} to ${dates[dates.length - 1]})`);

  let successCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  for (let i = 0; i < dates.length; i++) {
    const date = dates[i];
    const percent = ((i / dates.length) * 100).toFixed(1);
    const jsonPath = path.join(dataDir, `predictions_${date}.json`);

    // Check if we already have the parsed JSON file
    try {
      await fs.access(jsonPath);
      console.log(`[${percent}%] [${i + 1}/${dates.length}] Skipping ${date} (already scraped and parsed)`);
      skippedCount++;
      continue;
    } catch {
      // File does not exist, proceed with scraping
    }

    console.log(`[${percent}%] [${i + 1}/${dates.length}] Scraping ${date}...`);
    try {
      const games = await scrapeDate(date, apiKey, dataDir);
      
      const payload = {
        date,
        scrapedAt: new Date().toISOString(),
        gamesCount: games.length,
        games
      };

      await fs.writeFile(jsonPath, JSON.stringify(payload, null, 2), "utf-8");
      
      const correctCount = games.filter(g => g.pickResult.toLowerCase().includes("correct")).length;
      console.log(`[${percent}%] Successfully scraped ${date}: Found ${games.length} games. Pick accuracy: ${correctCount}/${games.length}`);
      successCount++;

      // Polite delay between scrapes (1.2 seconds) to respect rate limits and browser loading
      await new Promise(resolve => setTimeout(resolve, 1200));
    } catch (err: any) {
      console.error(`[${percent}%] Error scraping ${date}:`, err?.message || err);
      errorCount++;
      
      // Longer cool-off delay on error
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }

  // Compile final merged dataset
  console.log("\nScrape cycle complete. Merging all predictions into a single consolidated file...");
  const allMergedGames: any[] = [];
  
  for (const date of dates) {
    const jsonPath = path.join(dataDir, `predictions_${date}.json`);
    try {
      const content = await fs.readFile(jsonPath, "utf-8");
      const dayData = JSON.parse(content);
      for (const game of dayData.games) {
        allMergedGames.push({
          date: dayData.date,
          ...game
        });
      }
    } catch {
      // Missing dates are fine (either not scraped yet or failed)
    }
  }

  const finalPayload = {
    totalDaysScraped: dates.length - errorCount,
    totalGames: allMergedGames.length,
    scrapedAt: new Date().toISOString(),
    predictions: allMergedGames
  };

  await fs.writeFile(
    path.join(dataDir, "all_predictions_compiled.json"),
    JSON.stringify(finalPayload, null, 2),
    "utf-8"
  );

  console.log(`\nConsolidated compiled file written to scraped_data/all_predictions_compiled.json`);
  console.log(`Summary:`);
  console.log(`- Total days scoped: ${dates.length}`);
  console.log(`- Successfully scraped/loaded: ${dates.length - errorCount}`);
  console.log(`- Errors: ${errorCount}`);
  console.log(`- Total baseball games extracted: ${allMergedGames.length}`);
}

main().catch(console.error);
