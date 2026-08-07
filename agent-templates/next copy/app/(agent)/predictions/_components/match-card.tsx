"use client";

import { motion, useReducedMotion } from "framer-motion";
import type { MlbGame } from "@/lib/predictions/schema";
import {
  moneylineStakeCopy,
  ouStakeCopy,
  type SizedGame,
  type SizedOu,
} from "@/lib/predictions/size-game";
import { formatProbPercent } from "@/lib/predictions/format";
import { cn } from "@/utils/cn";

const CARD_CLASS =
  "rounded-[1.25rem] border border-white/10 bg-white/[0.03] p-6";

function MatchHeader({ game }: { game: MlbGame }) {
  return (
    <div>
      <time
        dateTime={game.date}
        className="font-mono text-xs uppercase tracking-[0.16em] text-white/60"
      >
        {game.date}
      </time>
      <div className="mt-2 text-xl font-medium leading-snug text-white md:text-2xl">
        <span className="text-white/70">{game.away_team}</span>
        <span className="mx-2 text-white/50">@</span>
        <span>{game.home_team}</span>
      </div>
    </div>
  );
}

function MetaLine({ game, ou }: { game: MlbGame; ou: SizedOu | null }) {
  const hasPred =
    game.predicted_away_score != null && game.predicted_home_score != null;
  const hasFinal =
    game.actual_away_score != null &&
    game.actual_home_score != null &&
    Boolean(game.actual_winner_team);

  if (!hasPred && !ou && !hasFinal) {
    return (
      <p className="mt-2 text-base text-white/60">Prediction unavailable</p>
    );
  }

  return (
    <p className="mt-2 text-base text-white/60">
      {hasPred ? (
        <span>
          Pred {game.predicted_away_score!.toFixed(1)}–
          {game.predicted_home_score!.toFixed(1)}
        </span>
      ) : (
        <span>Prediction unavailable</span>
      )}
      {ou ? (
        <span className="ml-3">
          Tot {ou.predictedTotal.toFixed(1)} · O/U {ou.line}
        </span>
      ) : null}
      {hasFinal ? (
        <span className="ml-3 text-white/50">
          Final {game.actual_away_score}-{game.actual_home_score} ·{" "}
          {game.actual_winner_team}
        </span>
      ) : null}
    </p>
  );
}

function MoneylineBlock({ sized }: { sized: SizedGame }) {
  const { game, pWin, moneyline, kelly, moneylineStatus } = sized;
  const stake = moneylineStakeCopy(kelly, moneylineStatus, moneyline);

  return (
    <div>
      <div className="text-sm text-white/60">ML · {game.predicted_winner}</div>
      <div className="mt-1 font-mono text-4xl font-semibold tabular-nums text-emerald-300">
        {formatProbPercent(pWin)}
      </div>
      <div className="text-sm text-white/60">chance they win</div>
      <div
        className={cn(
          "mt-2 font-mono text-sm",
          stake.tone === "bet" && "text-emerald-400",
          stake.tone === "skip" && "text-amber-300/90",
          stake.tone === "muted" && "text-white/50",
        )}
      >
        {stake.text}
      </div>
    </div>
  );
}

function OverUnderBlock({ ou }: { ou: SizedOu }) {
  const stake = ouStakeCopy(ou);

  return (
    <div>
      <div className="text-sm text-white/60">O/U · {ou.side}</div>
      <div className="mt-1 font-mono text-4xl font-semibold tabular-nums text-sky-300">
        {formatProbPercent(ou.pSide)}
      </div>
      <div className="text-sm text-white/60">chance it goes {ou.side}</div>
      <div
        className={cn(
          "mt-2 font-mono text-sm",
          stake.tone === "bet" && "text-sky-400",
          stake.tone === "skip" && "text-amber-300/90",
          stake.tone === "muted" && "text-white/50",
        )}
      >
        {stake.text}
      </div>
    </div>
  );
}

function useCardMotion(index: number) {
  const reduceMotion = useReducedMotion();
  // Never start at opacity 0. Mobile Safari / tunnel clients often miss
  // whileInView, which left the whole slate invisible.
  if (reduceMotion) {
    return {
      initial: false as const,
      whileInView: undefined,
      viewport: undefined,
      transition: undefined,
    };
  }
  return {
    initial: { opacity: 1, y: 12 },
    whileInView: { opacity: 1, y: 0 },
    viewport: { once: true, margin: "-40px" as const },
    transition: {
      duration: 0.5,
      delay: Math.min(index * 0.04, 0.25),
      ease: [0.32, 0.72, 0, 1] as const,
    },
  };
}

export function SizedMatchCard({
  sized,
  index,
}: {
  sized: SizedGame;
  index: number;
}) {
  const motionProps = useCardMotion(index);
  const { game, ou } = sized;

  return (
    <motion.li {...motionProps} className={CARD_CLASS}>
      <article>
        <MatchHeader game={game} />
        <MetaLine game={game} ou={ou} />
        <div className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2 sm:gap-8">
          <MoneylineBlock sized={sized} />
          {ou ? <OverUnderBlock ou={ou} /> : null}
        </div>
      </article>
    </motion.li>
  );
}

export function PendingMatchCard({
  game,
  index,
}: {
  game: MlbGame;
  index: number;
}) {
  const motionProps = useCardMotion(index);

  return (
    <motion.li {...motionProps} className={CARD_CLASS}>
      <article>
        <MatchHeader game={game} />
        <p className="mt-2 text-base text-amber-200/80">
          Sims still running. Check back for chance and stake.
        </p>
      </article>
    </motion.li>
  );
}
