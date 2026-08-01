"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import type { KellyMultiplier } from "@/lib/kelly";
import type { CalibrationBin } from "@/lib/predictions/schema";
import type {
  MlbGame,
  ModelParamsRow,
  TeamStatsRow,
} from "@/lib/predictions/schema";
import { MatchGrid } from "./match-grid";
import { SizerForm } from "./sizer-form";
import { StandingsTable } from "./standings-table";
import { Eyebrow } from "./double-bezel";

/** Recharts needs the browser for ResponsiveContainer sizing. */
const CalibrationChart = dynamic(
  () =>
    import("./calibration-chart").then((m) => m.CalibrationChart),
  {
    ssr: false,
    loading: () => (
      <div className="rounded-[2rem] border border-white/5 bg-white/5 p-2">
        <div className="flex h-72 items-center justify-center rounded-[1.5rem] border border-white/10 bg-[#0a0a0a] text-base text-white/40">
          Loading chart…
        </div>
      </div>
    ),
  },
);

export function DashboardShell({
  games,
  model,
  teamStats,
  today,
  fittedLabel,
  b0,
  b1,
  ouB0,
  ouB1,
}: {
  games: MlbGame[];
  model: ModelParamsRow | null;
  teamStats: TeamStatsRow[];
  today: string;
  fittedLabel: string | null;
  b0: number;
  b1: number;
  ouB0: number;
  ouB1: number;
}) {
  const [multiplier, setMultiplier] = useState<KellyMultiplier>(0.5);
  const bins = (model?.calibration ?? []) as CalibrationBin[];

  return (
    <div className="relative min-h-[100dvh] overflow-x-clip bg-[#050505] text-white">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 60% 40% at 15% 20%, rgba(16,185,129,0.14), transparent 55%), radial-gradient(ellipse 50% 45% at 85% 10%, rgba(51,65,85,0.35), transparent 50%), radial-gradient(ellipse 40% 30% at 70% 80%, rgba(16,185,129,0.08), transparent 45%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-[1] opacity-[0.015]"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
        }}
      />

      <div className="relative z-[2] mx-auto w-full max-w-[1400px] px-4 py-24 md:px-8">
        <header className="mb-16 flex flex-wrap items-end justify-between gap-6">
          <div className="max-w-3xl space-y-4">
            <Eyebrow>MLB predictions</Eyebrow>
            <h1 className="text-[clamp(2.5rem,2rem+2.5vw,3.75rem)] font-semibold leading-[1.05] tracking-tight text-white">
              Size bets from calibrated sims
            </h1>
            <p className="max-w-2xl text-lg leading-relaxed text-white/60">
              MyGameSim margins and totals run through logistic fits. ML{" "}
              <span className="font-mono text-base text-white/80">
                β₀={b0.toFixed(4)} · β₁={b1.toFixed(4)}
              </span>
              {" · "}O/U{" "}
              <span className="font-mono text-base text-white/80">
                β₀={ouB0.toFixed(4)} · β₁={ouB1.toFixed(4)}
              </span>
              {fittedLabel ? (
                <span className="ml-2 text-white/45">· fitted {fittedLabel}</span>
              ) : null}
            </p>
          </div>
          <Link
            href="/"
            className="rounded-full border border-white/10 bg-white/5 px-6 py-3 text-base text-white/75 transition-[transform,opacity] duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-white/10 hover:text-white"
          >
            Back to agent
          </Link>
        </header>

        <div className="grid grid-cols-1 gap-8 md:grid-cols-[61.8fr_38.2fr]">
          <div className="flex flex-col gap-8">
            <MatchGrid
              games={games}
              b0={b0}
              b1={b1}
              ouB0={ouB0}
              ouB1={ouB1}
              multiplier={multiplier}
              today={today}
            />
            <SizerForm
              b0={b0}
              b1={b1}
              onMultiplierChange={setMultiplier}
            />
          </div>
          <div className="flex flex-col gap-8">
            <CalibrationChart
              bins={bins}
              accuracy={model?.accuracy ?? 0}
              skillScore={model?.skill_score ?? 0}
            />
            <StandingsTable teams={teamStats} />
          </div>
        </div>
      </div>
    </div>
  );
}
