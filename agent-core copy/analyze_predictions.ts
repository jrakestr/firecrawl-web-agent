import * as fs from "fs/promises";
import * as path from "path";

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

interface ParsedGame {
  date: string;
  awayTeam: string;
  homeTeam: string;
  predictedWinner: string;
  predictedScore: string;
  actualResult: string;
  predictedMargin: number;
  winnerScore: number;
  loserScore: number;
  predictedWinnerScore: number;
  predictedOpponentScore: number;
  actualWinner: string;
  actualWinnerScore: number;
  actualLoserScore: number;
  didPredictedWinnerWin: boolean;
  ml: string; // original moneyline string
}

async function run() {
  const dataDir = path.join(process.cwd(), "agent-core copy", "scraped_data");
  const compiledPath = path.join(dataDir, "all_predictions_compiled.json");

  console.log(`Loading compiled predictions from ${compiledPath}...`);
  const content = await fs.readFile(compiledPath, "utf-8");
  const rawData = JSON.parse(content);
  const rawPredictions: RawGame[] = rawData.predictions;

  console.log(`Loaded ${rawPredictions.length} games. Cleaning and parsing dataset...`);

  const validGames: ParsedGame[] = [];
  const actualRegex = /^(.*?)\s+wins\s+(\d+)-(\d+)$/;

  for (const game of rawPredictions) {
    if (!game.actualResult || !game.predictedScore || !game.predictedWinner) {
      continue;
    }

    const actualMatch = game.actualResult.match(actualRegex);
    if (!actualMatch) {
      continue; // Skip postponed, canceled, or unplayed games
    }

    const actualWinner = actualMatch[1].trim();
    const actualWinnerScore = parseInt(actualMatch[2], 10);
    const actualLoserScore = parseInt(actualMatch[3], 10);

    const scoreParts = game.predictedScore.split("-");
    if (scoreParts.length !== 2) {
      continue;
    }

    const predWinnerScore = parseFloat(scoreParts[0]);
    const predLoserScore = parseFloat(scoreParts[1]);
    const margin = predWinnerScore - predLoserScore;

    if (isNaN(margin)) {
      continue;
    }

    const didPredictedWinnerWin = (actualWinner.toLowerCase() === game.predictedWinner.toLowerCase());

    validGames.push({
      date: game.date,
      awayTeam: game.awayTeam,
      homeTeam: game.homeTeam,
      predictedWinner: game.predictedWinner,
      predictedScore: game.predictedScore,
      actualResult: game.actualResult,
      predictedMargin: margin,
      winnerScore: predWinnerScore,
      loserScore: predLoserScore,
      predictedWinnerScore: predWinnerScore,
      predictedOpponentScore: predLoserScore,
      actualWinner,
      actualWinnerScore,
      actualLoserScore,
      didPredictedWinnerWin,
      ml: game.ml
    });
  }

  console.log(`Cleaned dataset contains ${validGames.length} valid completed games.`);

  // Fit Logistic Regression: P(Win) = 1 / (1 + exp(-(b0 + b1 * predictedMargin)))
  let b0 = 0.0;
  let b1 = 0.5; // Positive starting point since larger margin should correlate with higher probability
  const learningRate = 0.1;
  const epochs = 3000;

  for (let epoch = 0; epoch < epochs; epoch++) {
    let db0 = 0;
    let db1 = 0;
    for (const game of validGames) {
      const x = game.predictedMargin;
      const y = game.didPredictedWinnerWin ? 1 : 0;
      const z = b0 + b1 * x;
      const p = 1 / (1 + Math.exp(-z));
      const error = p - y;
      db0 += error;
      db1 += error * x;
    }
    b0 -= (learningRate * db0) / validGames.length;
    b1 -= (learningRate * db1) / validGames.length;
  }

  console.log(`Logistic regression parameters fitted successfully:`);
  console.log(`- beta_0 (intercept): ${b0.toFixed(4)}`);
  console.log(`- beta_1 (margin slope): ${b1.toFixed(4)}`);

  // Calculate stats
  const totalGames = validGames.length;
  const correctPredictions = validGames.filter(g => g.didPredictedWinnerWin).length;
  const accuracy = correctPredictions / totalGames;

  // Calculate Log-Loss
  let totalLogLossModel = 0;
  let totalLogLossBaseline = 0;
  const baseWinRate = correctPredictions / totalGames;

  for (const game of validGames) {
    const x = game.predictedMargin;
    const y = game.didPredictedWinnerWin ? 1 : 0;
    const z = b0 + b1 * x;
    const p = 1 / (1 + Math.exp(-z));
    
    // Cap probabilities to avoid log(0)
    const pCap = Math.max(0.0001, Math.min(0.9999, p));
    totalLogLossModel += -(y * Math.log(pCap) + (1 - y) * Math.log(1 - pCap));

    const pBaseCap = Math.max(0.0001, Math.min(0.9999, baseWinRate));
    totalLogLossBaseline += -(y * Math.log(pBaseCap) + (1 - y) * Math.log(1 - pBaseCap));
  }

  const logLossModel = totalLogLossModel / totalGames;
  const logLossBaseline = totalLogLossBaseline / totalGames;
  const skillScore = 1 - (logLossModel / logLossBaseline);

  console.log(`Backtest performance:`);
  console.log(`- Baseline (Flat Base Rate) Accuracy: ${(baseWinRate * 100).toFixed(2)}%`);
  console.log(`- Model Log-Loss: ${logLossModel.toFixed(4)}`);
  console.log(`- Baseline Log-Loss: ${logLossBaseline.toFixed(4)}`);
  console.log(`- Brier Skill Score improvement: ${(skillScore * 100).toFixed(2)}%`);

  // Build calibration bins
  const bins = [
    { name: "0.0 - 0.4 runs", min: 0, max: 0.4, count: 0, wins: 0, sumProb: 0 },
    { name: "0.4 - 0.8 runs", min: 0.4, max: 0.8, count: 0, wins: 0, sumProb: 0 },
    { name: "0.8 - 1.2 runs", min: 0.8, max: 1.2, count: 0, wins: 0, sumProb: 0 },
    { name: "1.2 - 1.6 runs", min: 1.2, max: 1.6, count: 0, wins: 0, sumProb: 0 },
    { name: "1.6+ runs", min: 1.6, max: Infinity, count: 0, wins: 0, sumProb: 0 }
  ];

  for (const game of validGames) {
    const margin = game.predictedMargin;
    const didWin = game.didPredictedWinnerWin;
    const z = b0 + b1 * margin;
    const p = 1 / (1 + Math.exp(-z));

    const bin = bins.find(b => margin >= b.min && margin < b.max);
    if (bin) {
      bin.count++;
      bin.sumProb += p;
      if (didWin) {
        bin.wins++;
      }
    }
  }

  const calibrationTable = bins.map(b => ({
    binName: b.name,
    count: b.count,
    actualWinRate: b.count > 0 ? b.wins / b.count : 0,
    averageModelProb: b.count > 0 ? b.sumProb / b.count : 0
  }));

  // Team-by-team analysis
  const teamMap = new Map<string, {
    totalGames: number;
    predictedWins: number;
    actualWinsWhenPredicted: number;
    totalActualWins: number;
    predictedMarginSum: number;
    predictedOpponentMarginSum: number;
    actualScoreSum: number;
    actualOppScoreSum: number;
    averageModelProbSum: number;
  }>();

  function getOrCreateTeam(teamName: string) {
    if (!teamMap.has(teamName)) {
      teamMap.set(teamName, {
        totalGames: 0,
        predictedWins: 0,
        actualWinsWhenPredicted: 0,
        totalActualWins: 0,
        predictedMarginSum: 0,
        predictedOpponentMarginSum: 0,
        actualScoreSum: 0,
        actualOppScoreSum: 0,
        averageModelProbSum: 0
      });
    }
    return teamMap.get(teamName)!;
  }

  for (const game of validGames) {
    const home = getOrCreateTeam(game.homeTeam);
    const away = getOrCreateTeam(game.awayTeam);

    home.totalGames++;
    away.totalGames++;

    // Track actual score totals
    const homeActualWinner = (game.actualWinner.toLowerCase() === game.homeTeam.toLowerCase());
    if (homeActualWinner) {
      home.totalActualWins++;
      home.actualScoreSum += game.actualWinnerScore;
      away.actualOppScoreSum += game.actualWinnerScore;
      away.actualScoreSum += game.actualLoserScore;
      home.actualOppScoreSum += game.actualLoserScore;
    } else {
      away.totalActualWins++;
      away.actualScoreSum += game.actualWinnerScore;
      home.actualOppScoreSum += game.actualWinnerScore;
      home.actualScoreSum += game.actualLoserScore;
      away.actualOppScoreSum += game.actualLoserScore;
    }

    // Is team the predicted winner?
    const isHomePredicted = (game.predictedWinner.toLowerCase() === game.homeTeam.toLowerCase());
    const z = b0 + b1 * game.predictedMargin;
    const p = 1 / (1 + Math.exp(-z));

    if (isHomePredicted) {
      home.predictedWins++;
      home.predictedMarginSum += game.predictedMargin;
      home.averageModelProbSum += p;
      if (game.didPredictedWinnerWin) {
        home.actualWinsWhenPredicted++;
      }
    } else {
      away.predictedWins++;
      away.predictedMarginSum += game.predictedMargin;
      away.averageModelProbSum += p;
      if (game.didPredictedWinnerWin) {
        away.actualWinsWhenPredicted++;
      }
    }
  }

  const teamStats = Array.from(teamMap.entries()).map(([teamName, data]) => {
    const totalWinRate = data.totalActualWins / data.totalGames;
    const accuracyWhenPredicted = data.predictedWins > 0 ? data.actualWinsWhenPredicted / data.predictedWins : 0;
    const avgModelProbWhenPredicted = data.predictedWins > 0 ? data.averageModelProbSum / data.predictedWins : 0;
    const averageMargin = data.predictedWins > 0 ? data.predictedMarginSum / data.predictedWins : 0;
    const averageActualScore = data.actualScoreSum / data.totalGames;
    const averageActualOppScore = data.actualOppScoreSum / data.totalGames;
    
    // Bias: actual win rate when predicted minus predicted model win rate
    const bias = data.predictedWins > 0 ? accuracyWhenPredicted - avgModelProbWhenPredicted : 0;

    return {
      teamName,
      totalGames: data.totalGames,
      predictedWins: data.predictedWins,
      actualWinsWhenPredicted: data.actualWinsWhenPredicted,
      totalActualWins: data.totalActualWins,
      accuracyWhenPredicted,
      bias,
      averageMargin,
      averageActualScore,
      averageActualOppScore,
      totalWinRate
    };
  }).sort((a, b) => b.accuracyWhenPredicted - a.accuracyWhenPredicted);

  // Compile final output payload
  const modelPayload = {
    metadata: {
      generatedAt: new Date().toISOString(),
      totalGamesBacktested: totalGames,
      overallAccuracy: accuracy,
      baseWinRate,
      logLoss: {
        model: logLossModel,
        baseline: logLossBaseline,
        improvementPercent: skillScore * 100
      },
      fittedParams: {
        b0,
        b1
      }
    },
    calibrationTable,
    teamStats
  };

  const outputPath = path.join(dataDir, "mlb_predictions_model_params.json");
  await fs.writeFile(outputPath, JSON.stringify(modelPayload, null, 2), "utf-8");
  console.log(`Model parameter analysis written successfully to ${outputPath}`);
}

run().catch(console.error);
