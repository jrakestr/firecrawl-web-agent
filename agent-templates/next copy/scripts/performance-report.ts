/**
 * Plain-English performance report for settled MLB predictions.
 * Usage: node --import tsx scripts/performance-report.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { runBacktest } from "../lib/backtest";
import {
  americanToDecimal,
  calibratedPWin,
  kellyFraction,
  moneylineForPredictedWinner,
} from "../lib/kelly";
import type { MlbPredictionRow } from "../lib/predictions/schema";

function loadEnv() {
  return Object.fromEntries(
    readFileSync(join(__dirname, "..", ".env.local"), "utf8")
      .split("\n")
      .filter((l) => l && !l.startsWith("#") && l.includes("="))
      .map((l) => {
        const i = l.indexOf("=");
        return [l.slice(0, i), l.slice(i + 1)];
      }),
  );
}

function asBacktestRow(r: Record<string, unknown>): MlbPredictionRow {
  return r as unknown as MlbPredictionRow;
}

async function main() {
  const env = loadEnv();
  const sb = createClient(env.SUPABASE_URL!, env.SUPABASE_SECRET_KEY!);

  const pageSize = 1000;
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await sb
      .from("mlb_predictions")
      .select(
        "date,away_team,home_team,predicted_winner,predicted_margin,predicted_away_score,predicted_home_score,predicted_total,over_under_line,actual_away_score,actual_home_score,actual_total_score,actual_winner_team,away_moneyline,home_moneyline,winner_pick_correct",
      )
      .not("actual_winner_team", "is", null)
      .order("date", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < pageSize) break;
  }

  const settled = rows.filter(
    (r) =>
      r.predicted_winner &&
      r.predicted_margin != null &&
      r.actual_winner_team &&
      r.actual_away_score != null &&
      r.actual_home_score != null,
  );

  const pickCorrect = settled.filter(
    (r) =>
      String(r.actual_winner_team).toLowerCase() ===
      String(r.predicted_winner).toLowerCase(),
  ).length;

  const byMonth: Record<string, { n: number; hit: number }> = {};
  for (const r of settled) {
    const m = String(r.date).slice(0, 7);
    if (!byMonth[m]) byMonth[m] = { n: 0, hit: 0 };
    byMonth[m].n++;
    if (
      String(r.actual_winner_team).toLowerCase() ===
      String(r.predicted_winner).toLowerCase()
    ) {
      byMonth[m].hit++;
    }
  }

  let naiveBets = 0;
  let naiveWins = 0;
  let naiveProfit = 0;
  for (const r of settled) {
    const ml = moneylineForPredictedWinner({
      predictedWinner: String(r.predicted_winner),
      awayTeam: String(r.away_team),
      homeTeam: String(r.home_team),
      awayMoneyline: r.away_moneyline as number | null,
      homeMoneyline: r.home_moneyline as number | null,
    });
    if (ml == null || !Number.isFinite(ml) || (ml > -100 && ml < 100)) continue;
    const won =
      String(r.actual_winner_team).toLowerCase() ===
      String(r.predicted_winner).toLowerCase();
    const dec = americanToDecimal(ml);
    naiveBets++;
    if (won) {
      naiveWins++;
      naiveProfit += dec - 1;
    } else {
      naiveProfit -= 1;
    }
  }

  const byDate = new Map<string, Record<string, unknown>[]>();
  for (const r of settled) {
    const d = String(r.date);
    if (!byDate.has(d)) byDate.set(d, []);
    byDate.get(d)!.push(r);
  }
  const dates = [...byDate.keys()].sort();
  const MIN_TRAIN = 400;

  let bankroll = 1;
  let kellyBets = 0;
  let kellyWins = 0;
  let flatUnitBets = 0;
  let flatUnitWins = 0;
  let flatUnitProfit = 0;
  let trainRows: MlbPredictionRow[] = [];

  for (const d of dates) {
    const day = byDate.get(d)!;
    if (trainRows.length >= MIN_TRAIN) {
      const fit = runBacktest(trainRows);
      for (const r of day) {
        const ml = moneylineForPredictedWinner({
          predictedWinner: String(r.predicted_winner),
          awayTeam: String(r.away_team),
          homeTeam: String(r.home_team),
          awayMoneyline: r.away_moneyline as number | null,
          homeMoneyline: r.home_moneyline as number | null,
        });
        if (ml == null || !Number.isFinite(ml) || (ml > -100 && ml < 100)) {
          continue;
        }
        const margin = Math.abs(Number(r.predicted_margin));
        const p = calibratedPWin(margin, fit.b0, fit.b1);
        const k = kellyFraction(p, ml, 0.5);
        if (k.recommendation !== "BET" || k.sizedFraction <= 0) continue;

        const won =
          String(r.actual_winner_team).toLowerCase() ===
          String(r.predicted_winner).toLowerCase();
        const dec = americanToDecimal(ml);
        const stakeAmt = bankroll * k.sizedFraction;
        kellyBets++;
        if (won) {
          kellyWins++;
          bankroll += stakeAmt * (dec - 1);
        } else {
          bankroll -= stakeAmt;
        }

        flatUnitBets++;
        if (won) {
          flatUnitWins++;
          flatUnitProfit += dec - 1;
        } else {
          flatUnitProfit -= 1;
        }
      }
    }
    trainRows = trainRows.concat(day.map(asBacktestRow));
  }

  let ouBets = 0;
  let ouWins = 0;
  let ouBank = 1;
  trainRows = [];
  for (const d of dates) {
    const day = byDate.get(d)!;
    if (trainRows.length >= MIN_TRAIN) {
      const fit = runBacktest(trainRows);
      if (fit.ou) {
        for (const r of day) {
          if (
            r.over_under_line == null ||
            r.predicted_total == null ||
            r.actual_total_score == null
          ) {
            continue;
          }
          const line = Number(r.over_under_line);
          const total = Number(r.actual_total_score);
          const pred = Number(r.predicted_total);
          const edge = pred - line;
          if (![line, total, pred, edge].every(Number.isFinite)) continue;
          if (total === line) continue;

          const pOver = calibratedPWin(edge, fit.ou.b0, fit.ou.b1);
          const side = pOver >= 0.5 ? "Over" : "Under";
          const pSide = side === "Over" ? pOver : 1 - pOver;
          const k = kellyFraction(pSide, -110, 0.5);
          if (k.recommendation !== "BET" || k.sizedFraction <= 0) continue;

          const wentOver = total > line;
          const won = side === "Over" ? wentOver : !wentOver;
          const stakeAmt = ouBank * k.sizedFraction;
          const dec = americanToDecimal(-110);
          ouBets++;
          if (won) {
            ouWins++;
            ouBank += stakeAmt * (dec - 1);
          } else {
            ouBank -= stakeAmt;
          }
        }
      }
    }
    trainRows = trainRows.concat(day.map(asBacktestRow));
  }

  const full = runBacktest(settled.map(asBacktestRow));
  const last14 = settled.filter((r) => String(r.date) >= String(full.testStartDate));
  const last14Hit = last14.filter(
    (r) =>
      String(r.actual_winner_team).toLowerCase() ===
      String(r.predicted_winner).toLowerCase(),
  ).length;

  console.log(
    JSON.stringify(
      {
        range: {
          first: settled[0]?.date,
          last: settled.at(-1)?.date,
          n: settled.length,
        },
        rawPickAccuracy: pickCorrect / settled.length,
        monthly: Object.fromEntries(
          Object.entries(byMonth).map(([k, v]) => [
            k,
            { games: v.n, hitPct: +(v.hit / v.n).toFixed(3) },
          ]),
        ),
        holdoutLast14Days: {
          from: full.testStartDate,
          games: last14.length,
          hitPct: last14.length ? last14Hit / last14.length : null,
          skillVsCoinFlip: full.metrics.oosSkillScore,
        },
        allTimeSkill: full.metrics.skillScore,
        ou: full.ou
          ? {
              games: full.ou.totalGames,
              sideHitPct: full.ou.accuracy,
              holdoutHitPct: full.ou.oosAccuracy,
              skill: full.ou.skillScore,
            }
          : null,
        naiveAlwaysBetPredictedWinner: {
          bets: naiveBets,
          winPct: naiveBets ? naiveWins / naiveBets : null,
          profitPer1DollarBet: naiveBets ? naiveProfit / naiveBets : null,
          totalProfitIf1PerGame: naiveProfit,
        },
        walkForwardHalfKellyML: {
          bets: kellyBets,
          winPct: kellyBets ? kellyWins / kellyBets : null,
          endingBankrollFrom1: bankroll,
          returnPct: (bankroll - 1) * 100,
          flat1DollarOnSameBets: {
            bets: flatUnitBets,
            winPct: flatUnitBets ? flatUnitWins / flatUnitBets : null,
            totalProfit: flatUnitProfit,
            roiPerBet: flatUnitBets ? flatUnitProfit / flatUnitBets : null,
          },
        },
        walkForwardHalfKellyOU: {
          bets: ouBets,
          winPct: ouBets ? ouWins / ouBets : null,
          endingBankrollFrom1: ouBank,
          returnPct: (ouBank - 1) * 100,
        },
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
