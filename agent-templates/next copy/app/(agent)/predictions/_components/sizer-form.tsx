"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import type { KellyMultiplier } from "@/lib/kelly";
import { sizeWhatIf } from "@/lib/predictions/size-game";
import { DoubleBezel, Eyebrow } from "./double-bezel";
import { PillButton } from "./pill-button";

const MULTIPLIERS: { label: string; value: KellyMultiplier }[] = [
  { label: "Full", value: 1 },
  { label: "Half", value: 0.5 },
  { label: "Quarter", value: 0.25 },
];

export function SizerForm({
  b0,
  b1,
  bankrollDefault = 10000,
  onMultiplierChange,
}: {
  b0: number;
  b1: number;
  bankrollDefault?: number;
  onMultiplierChange?: (m: KellyMultiplier) => void;
}) {
  const [awayScore, setAwayScore] = useState("4.8");
  const [homeScore, setHomeScore] = useState("4.1");
  const [moneyline, setMoneyline] = useState("-110");
  const [bankroll, setBankroll] = useState(String(bankrollDefault));
  const [multiplier, setMultiplier] = useState<KellyMultiplier>(0.5);

  const result = useMemo(
    () =>
      sizeWhatIf({
        awayScore: Number(awayScore),
        homeScore: Number(homeScore),
        moneyline: Number(moneyline),
        bankroll: Number(bankroll),
        b0,
        b1,
        multiplier,
      }),
    [awayScore, homeScore, moneyline, bankroll, multiplier, b0, b1],
  );

  return (
    <DoubleBezel>
      <div className="p-6 md:p-8">
        <div className="mb-8 space-y-3">
          <Eyebrow>Kelly sizer</Eyebrow>
          <h2 className="text-[clamp(1.75rem,1.5rem+1vw,2.25rem)] font-semibold tracking-tight text-white">
            What-if calculator
          </h2>
          <p className="text-base leading-relaxed text-white/55">
            Plug in predicted scores and a moneyline. See the stake before you
            risk real bankroll.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Predicted away score"
            value={awayScore}
            onChange={setAwayScore}
          />
          <Field
            label="Predicted home score"
            value={homeScore}
            onChange={setHomeScore}
          />
          <Field
            label="Moneyline for the pick"
            value={moneyline}
            onChange={setMoneyline}
          />
          <Field label="Bankroll $" value={bankroll} onChange={setBankroll} />
        </div>

        <div className="mt-8 flex flex-wrap gap-3">
          {MULTIPLIERS.map((m) => (
            <PillButton
              key={m.value}
              active={multiplier === m.value}
              onClick={() => {
                setMultiplier(m.value);
                onMultiplierChange?.(m.value);
              }}
            >
              {m.label} Kelly
            </PillButton>
          ))}
        </div>

        {result?.error ? (
          <p className="mt-8 text-base text-amber-300/90">{result.error}</p>
        ) : result?.kelly ? (
          <motion.div
            key={`${result.pWin}-${multiplier}`}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: [0.32, 0.72, 0, 1] }}
            className="mt-10 grid gap-6 rounded-[1.25rem] border border-white/10 bg-gradient-to-br from-emerald-500/10 to-transparent p-6 sm:grid-cols-3"
          >
            <Stat
              label="Chance they win"
              value={`${(result.pWin * 100).toFixed(1)}%`}
            />
            <Stat
              label="Edge vs the line"
              value={`${(result.kelly.expectedValue * 100).toFixed(1)}%`}
            />
            <Stat
              label={
                result.kelly.recommendation === "BET"
                  ? "Bet this much"
                  : "Recommendation"
              }
              value={
                result.kelly.recommendation === "BET"
                  ? `$${result.stake.toFixed(0)} (${(result.kelly.sizedFraction * 100).toFixed(1)}% bankroll)`
                  : "Skip · no edge"
              }
              accent={result.kelly.recommendation === "BET"}
            />
          </motion.div>
        ) : (
          <p className="mt-8 text-base text-amber-300/90">
            Scores need to be numbers. Moneyline must be American odds at ±100
            or farther.
          </p>
        )}
      </div>
    </DoubleBezel>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block space-y-2">
      <span className="text-sm font-medium text-white/55">{label}</span>
      <div className="rounded-2xl border border-white/5 bg-white/5 p-1.5">
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-[0.75rem] border border-white/10 bg-[#0a0a0a] px-4 py-3.5 font-mono text-lg text-white outline-none transition-[border-color,opacity] duration-500 focus:border-emerald-400/40"
        />
      </div>
    </label>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div>
      <div className="text-sm text-white/50">{label}</div>
      <div
        className={
          accent
            ? "mt-2 font-mono text-3xl font-semibold tabular-nums text-emerald-300"
            : "mt-2 font-mono text-3xl font-semibold tabular-nums text-white"
        }
      >
        {value}
      </div>
    </div>
  );
}
