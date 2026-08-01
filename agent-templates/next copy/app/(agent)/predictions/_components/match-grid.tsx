"use client";

import { useMemo } from "react";
import type { KellyMultiplier } from "@/lib/kelly";
import type { MlbGame } from "@/lib/predictions/schema";
import {
  boardCopyForMode,
  partitionBoard,
} from "@/lib/predictions/size-game";
import { DoubleBezel, Eyebrow } from "./double-bezel";
import { PendingMatchCard, SizedMatchCard } from "./match-card";

/**
 * MatchGrid stays a client component because Kelly multiplier toggles live
 * in the browser and re-runs partitionBoard.
 *
 * b0/b1 and ouB0/ouB1 are logistic intercept/slope for ML and OU models.
 */
export type MatchGridProps = {
  games: MlbGame[];
  /** ML logistic intercept */
  b0: number;
  /** ML logistic slope on predicted margin */
  b1: number;
  /** OU logistic intercept */
  ouB0: number;
  /** OU logistic slope on sim−line edge (runs) */
  ouB1: number;
  multiplier: KellyMultiplier;
  today: string;
};

export function MatchGrid({
  games,
  b0,
  b1,
  ouB0,
  ouB1,
  multiplier,
  today,
}: MatchGridProps) {
  const board = useMemo(
    () => partitionBoard(games, today, b0, b1, multiplier, ouB0, ouB1),
    [games, today, b0, b1, ouB0, ouB1, multiplier],
  );

  const copy = boardCopyForMode(board.mode, {
    sizedCount: board.sized.length,
    pendingCount: board.pending.length,
    multiplier,
  });

  return (
    <DoubleBezel>
      <div className="p-6 md:p-8">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-3">
            <Eyebrow>Matchups</Eyebrow>
            <h2 className="text-[clamp(1.75rem,1.5rem+1vw,2.25rem)] font-semibold tracking-tight text-white">
              {copy.title}
            </h2>
            <p className="max-w-xl text-base leading-relaxed text-white/60">
              {copy.blurb}
            </p>
          </div>
          <span className="font-mono text-sm text-emerald-400/90">
            {copy.meta}
          </span>
        </div>

        {board.mode === "pending" ? (
          <ul className="grid list-none gap-4 p-0">
            {board.pending.map((g, i) => (
              <PendingMatchCard key={g.id} game={g} index={i} />
            ))}
          </ul>
        ) : null}

        {board.mode === "today" || board.mode === "recent" ? (
          <ul className="grid list-none gap-4 p-0">
            {board.sized.map((sized, i) => (
              <SizedMatchCard key={sized.game.id} sized={sized} index={i} />
            ))}
          </ul>
        ) : null}
      </div>
    </DoubleBezel>
  );
}
