import type { Metadata } from "next";
import { loadBoard } from "@/lib/predictions/board";
import { DashboardShell } from "./_components/dashboard-shell";

export const runtime = "nodejs";
export const revalidate = 300;

export const metadata: Metadata = {
  title: "MLB Predictions",
  description:
    "Calibrated MyGameSim win and Over/Under probs, Kelly stake sizing, and team Brier scores.",
};

export default async function PredictionsPage() {
  const board = await loadBoard(50);

  return (
    <DashboardShell
      games={board.games}
      model={board.model}
      teamStats={board.teamStats}
      today={board.today}
      fittedLabel={board.fittedLabel}
      b0={board.b0}
      b1={board.b1}
      ouB0={board.ouB0}
      ouB1={board.ouB1}
    />
  );
}
