"use client";

import { useMemo, useState, type ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import type { TeamStatsRow } from "@/lib/predictions/fetch";
import { DoubleBezel, Eyebrow } from "./double-bezel";
import { cn } from "@/utils/cn";

type SortKey =
  | "brier_score"
  | "bias_magnitude"
  | "prediction_accuracy"
  | "total_games"
  | "team_name";

export function StandingsTable({ teams }: { teams: TeamStatsRow[] }) {
  // Default: worst miss score first (high Brier = model missed more)
  const [sortKey, setSortKey] = useState<SortKey>("brier_score");
  const [asc, setAsc] = useState(false);
  const reduceMotion = useReducedMotion();

  const sorted = useMemo(() => {
    const rows = [...teams];
    rows.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === "string" && typeof bv === "string") {
        return asc ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      const an = Number(av);
      const bn = Number(bv);
      if (sortKey === "bias_magnitude") {
        return asc
          ? Math.abs(an) - Math.abs(bn)
          : Math.abs(bn) - Math.abs(an);
      }
      return asc ? an - bn : bn - an;
    });
    return rows;
  }, [teams, sortKey, asc]);

  const toggle = (key: SortKey) => {
    if (key === sortKey) setAsc((v) => !v);
    else {
      setSortKey(key);
      // Miss score defaults to worst-first; other keys start ascending
      setAsc(key !== "brier_score");
    }
  };

  return (
    <DoubleBezel>
      <div className="p-6 md:p-8">
        <div className="mb-8 space-y-3">
          <Eyebrow>By team</Eyebrow>
          <h2 className="text-2xl font-semibold text-white">
            Teams that throw the model off
          </h2>
          <p className="text-base leading-relaxed text-white/60">
            Top of the list means the sims missed this team most. If they play
            today, size smaller or skip.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-base">
            <thead>
              <tr className="border-b border-white/10 text-sm font-medium text-white/60">
                <Th onClick={() => toggle("team_name")}>Team</Th>
                <Th onClick={() => toggle("total_games")}>G</Th>
                <Th onClick={() => toggle("prediction_accuracy")}>Hit %</Th>
                <Th onClick={() => toggle("brier_score")}>Miss score</Th>
                <Th onClick={() => toggle("bias_magnitude")}>Score bias</Th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((t, i) => (
                <motion.tr
                  key={t.team_name}
                  initial={reduceMotion ? false : { opacity: 0, y: 12 }}
                  whileInView={
                    reduceMotion ? undefined : { opacity: 1, y: 0 }
                  }
                  viewport={reduceMotion ? undefined : { once: true }}
                  transition={
                    reduceMotion
                      ? undefined
                      : {
                          duration: 0.6,
                          delay: Math.min(i * 0.02, 0.3),
                          ease: [0.32, 0.72, 0, 1],
                        }
                  }
                  className="border-b border-white/5"
                >
                  <td className="py-4 pr-4 font-medium text-white/90">
                    {t.team_name}
                  </td>
                  <td className="py-4 pr-4 font-mono text-white/60">
                    {t.total_games}
                  </td>
                  <td className="py-4 pr-4 font-mono tabular-nums text-white/75">
                    {(t.prediction_accuracy * 100).toFixed(1)}%
                  </td>
                  <td className="py-4 pr-4 font-mono tabular-nums text-emerald-300">
                    {t.brier_score.toFixed(3)}
                  </td>
                  <td
                    className={cn(
                      "py-4 font-mono tabular-nums",
                      t.bias_magnitude > 0
                        ? "text-amber-300"
                        : "text-sky-300",
                    )}
                    title={
                      t.bias_magnitude > 0
                        ? "Sims ran their score too high"
                        : "Sims ran their score too low"
                    }
                  >
                    {t.bias_magnitude > 0 ? "+" : ""}
                    {t.bias_magnitude.toFixed(2)}
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
    <th className="pb-4 pr-4">
      <button
        type="button"
        onClick={onClick}
        className="transition-opacity duration-500 hover:text-white/80"
      >
        {children}
      </button>
    </th>
  );
}
