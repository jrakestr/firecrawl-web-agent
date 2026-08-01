"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import type { KellyMultiplier } from "@/lib/kelly";
import type { MlbGame } from "@/lib/predictions/schema";
import { partitionBoard } from "@/lib/predictions/size-game";
import { DoubleBezel, Eyebrow } from "./double-bezel";

export function MatchGrid({
  games,
  b0,
  b1,
  ouB0,
  ouB1,
  multiplier,
  today,
}: {
  games: MlbGame[];
  b0: number;
  b1: number;
  ouB0: number;
  ouB1: number;
  multiplier: KellyMultiplier;
  today: string;
}) {
  const board = useMemo(
    () => partitionBoard(games, today, b0, b1, multiplier, ouB0, ouB1),
    [games, today, b0, b1, ouB0, ouB1, multiplier],
  );

  const title =
    board.mode === "pending"
      ? "Tomorrow's slate"
      : board.mode === "today"
        ? "Today's board"
        : board.mode === "recent"
          ? "Recent games"
          : "Matchups";

  const blurb =
    board.mode === "pending"
      ? "Games are posted, but MyGameSim hasn't finished the sims. Chance and stake show up once scores and moneylines land."
      : "Left = moneyline win chance. Right = Over/Under at −110 juice. Stake or skip under each.";

  const meta =
    board.mode === "pending"
      ? `${board.pending.length} matchups · pending sims`
      : `${board.sized.length} games · Kelly ×${multiplier}`;

  return (
    <DoubleBezel>
      <div className="p-6 md:p-8">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-3">
            <Eyebrow>Matchups</Eyebrow>
            <h2 className="text-[clamp(1.75rem,1.5rem+1vw,2.25rem)] font-semibold tracking-tight text-white">
              {title}
            </h2>
            <p className="max-w-xl text-base leading-relaxed text-white/55">
              {blurb}
            </p>
          </div>
          <span className="font-mono text-sm text-emerald-400/90">{meta}</span>
        </div>

        <div className="grid gap-4">
          {board.sized.map(
            ({ game: g, pWin, moneyline, kelly, moneylineStatus, ou }, i) => (
            <motion.div
              key={g.id}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-40px" }}
              transition={{
                duration: 0.8,
                delay: Math.min(i * 0.05, 0.35),
                ease: [0.32, 0.72, 0, 1],
              }}
              className="rounded-[1.25rem] border border-white/10 bg-white/[0.03] p-6"
            >
              <div className="flex flex-wrap items-start justify-between gap-6">
                <div className="min-w-0 flex-1">
                  <div className="font-mono text-xs uppercase tracking-[0.16em] text-white/45">
                    {g.date}
                  </div>
                  <div className="mt-2 text-xl font-medium leading-snug text-white md:text-2xl">
                    <span className="text-white/70">{g.away_team}</span>
                    <span className="mx-2 text-white/35">@</span>
                    <span>{g.home_team}</span>
                  </div>
                  <div className="mt-2 text-base text-white/50">
                    Pred {g.predicted_away_score?.toFixed(1)}–
                    {g.predicted_home_score?.toFixed(1)}
                    {ou ? (
                      <span className="ml-3 text-white/40">
                        Tot {ou.predictedTotal.toFixed(1)} · O/U {ou.line}
                      </span>
                    ) : null}
                    {g.actual_winner_team ? (
                      <span className="ml-3 text-white/35">
                        Final {g.actual_away_score}-{g.actual_home_score} ·{" "}
                        {g.actual_winner_team}
                      </span>
                    ) : null}
                  </div>
                </div>

                <div className="flex flex-wrap gap-8 sm:gap-10">
                  <div className="text-right">
                    <div className="text-sm text-white/45">
                      ML · {g.predicted_winner}
                    </div>
                    <div className="mt-1 font-mono text-4xl font-semibold tabular-nums text-emerald-300">
                      {(pWin * 100).toFixed(1)}%
                    </div>
                    <div className="text-sm text-white/45">chance they win</div>
                    <div className="mt-2 font-mono text-sm text-white/55">
                      Line {moneyline ?? "—"}
                      {" · "}
                      {kelly ? (
                        kelly.recommendation === "BET" ? (
                          <span className="text-emerald-400">
                            Bet {(kelly.sizedFraction * 100).toFixed(1)}% of
                            bankroll
                          </span>
                        ) : (
                          <span className="text-amber-300/90">
                            Skip · no edge at this line
                          </span>
                        )
                      ) : moneylineStatus === "invalid" ? (
                        <span className="text-amber-300/90">
                          Skip · moneyline looks broken
                        </span>
                      ) : (
                        <span className="text-white/40">No moneyline yet</span>
                      )}
                    </div>
                  </div>

                  {ou ? (
                    <div className="text-right">
                      <div className="text-sm text-white/45">
                        O/U · {ou.side}
                      </div>
                      <div className="mt-1 font-mono text-4xl font-semibold tabular-nums text-sky-300">
                        {(ou.pOver * 100).toFixed(1)}%
                      </div>
                      <div className="text-sm text-white/45">
                        chance it goes Over
                      </div>
                      <div className="mt-2 font-mono text-sm text-white/55">
                        Edge {ou.edge >= 0 ? "+" : ""}
                        {ou.edge.toFixed(1)} @ {ou.moneyline}
                        {" · "}
                        {ou.kelly ? (
                          ou.kelly.recommendation === "BET" ? (
                            <span className="text-sky-400">
                              Bet {ou.side}{" "}
                              {(ou.kelly.sizedFraction * 100).toFixed(1)}%
                            </span>
                          ) : (
                            <span className="text-amber-300/90">
                              Skip · no edge at −110
                            </span>
                          )
                        ) : (
                          <span className="text-white/40">OU unavailable</span>
                        )}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            </motion.div>
          ),
          )}

          {board.mode === "pending"
            ? board.pending.map((g, i) => (
                <motion.div
                  key={g.id}
                  initial={{ opacity: 0, y: 24 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: "-40px" }}
                  transition={{
                    duration: 0.8,
                    delay: Math.min(i * 0.04, 0.3),
                    ease: [0.32, 0.72, 0, 1],
                  }}
                  className="rounded-[1.25rem] border border-white/10 bg-white/[0.03] p-6"
                >
                  <div className="font-mono text-xs uppercase tracking-[0.16em] text-white/45">
                    {g.date}
                  </div>
                  <div className="mt-2 text-xl font-medium leading-snug text-white md:text-2xl">
                    <span className="text-white/70">{g.away_team}</span>
                    <span className="mx-2 text-white/35">@</span>
                    <span>{g.home_team}</span>
                  </div>
                  <div className="mt-2 text-base text-amber-200/70">
                    Sims still running. Check back for chance and stake.
                  </div>
                </motion.div>
              ))
            : null}

          {board.mode === "empty" ? (
            <p className="text-base text-white/45">
              No games in the feed yet. The daily scrape fills this board.
            </p>
          ) : null}
        </div>
      </div>
    </DoubleBezel>
  );
}
