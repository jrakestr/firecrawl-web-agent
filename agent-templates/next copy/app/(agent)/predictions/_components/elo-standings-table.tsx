"use client";

import { useMemo, useState, type ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import type { EloTeamRating } from "@/lib/predictions/elo";
import { DoubleBezel, Eyebrow } from "./double-bezel";
import { cn } from "@/utils/cn";

type SortKey = "elo" | "games" | "team";

export function EloStandingsTable({
  standings,
  k,
  homeAdvantage,
}: {
  standings: EloTeamRating[];
  k: number;
  homeAdvantage: number;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("elo");
  const [asc, setAsc] = useState(false);
  const reduceMotion = useReducedMotion();

  const sorted = useMemo(() => {
    const rows = [...standings];
    rows.sort((a, b) => {
      if (sortKey === "team") {
        return asc
          ? a.team.localeCompare(b.team)
          : b.team.localeCompare(a.team);
      }
      const an = sortKey === "elo" ? a.elo : a.games;
      const bn = sortKey === "elo" ? b.elo : b.games;
      return asc ? an - bn : bn - an;
    });
    return rows;
  }, [standings, sortKey, asc]);

  const toggle = (key: SortKey) => {
    if (key === sortKey) setAsc((v) => !v);
    else {
      setSortKey(key);
      setAsc(key === "team");
    }
  };

  return (
    <DoubleBezel>
      <div className="p-6 md:p-8">
        <div className="mb-8 space-y-3">
          <Eyebrow>Season Elo</Eyebrow>
          <h2 className="text-2xl font-semibold text-white">
            Strength from real results
          </h2>
          <p className="text-base leading-relaxed text-white/60">
            Starts at 1500 on Opening Day. Each final updates ratings with K=
            {k} and +{homeAdvantage} home field. This is not the sim — it is
            win/loss only.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] text-left text-base">
            <thead>
              <tr className="border-b border-white/10 text-sm font-medium text-white/60">
                <Th onClick={() => toggle("team")}>Team</Th>
                <Th onClick={() => toggle("games")}>G</Th>
                <Th onClick={() => toggle("elo")}>Elo</Th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((t, i) => (
                <motion.tr
                  key={t.team}
                  initial={reduceMotion ? false : { opacity: 1, y: 8 }}
                  whileInView={
                    reduceMotion ? undefined : { opacity: 1, y: 0 }
                  }
                  viewport={{ once: true, margin: "-20px" }}
                  transition={{
                    duration: 0.35,
                    delay: Math.min(i * 0.02, 0.2),
                  }}
                  className="border-b border-white/5"
                >
                  <td className="py-3 pr-4 text-white">{t.team}</td>
                  <td className="py-3 pr-4 font-mono text-white/70">
                    {t.games}
                  </td>
                  <td className="py-3 font-mono tabular-nums text-violet-300">
                    {Math.round(t.elo)}
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </DoubleBezel>
  );
}

function Th({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <th className="pb-3 pr-4 font-medium">
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "text-left transition-colors hover:text-white",
          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/40",
        )}
      >
        {children}
      </button>
    </th>
  );
}
