"use client";

import { motion, useReducedMotion } from "framer-motion";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { CalibrationBin } from "@/lib/predictions/schema";
import { DoubleBezel, Eyebrow } from "./double-bezel";

export function CalibrationChart({
  bins,
  accuracy,
  skillScore,
}: {
  bins: CalibrationBin[];
  accuracy: number;
  skillScore: number;
}) {
  const reduceMotion = useReducedMotion();
  const data = bins.map((b) => ({
    name: b.binName.replace(" runs", ""),
    actual: Number((b.actualWinRate * 100).toFixed(1)),
    model: Number((b.averageModelProb * 100).toFixed(1)),
    count: b.count,
  }));

  const values = data.flatMap((d) => [d.actual, d.model]).filter(Number.isFinite);
  const minY = values.length ? Math.min(...values) : 40;
  const maxY = values.length ? Math.max(...values) : 70;
  const pad = 5;
  const domain: [number, number] = [
    Math.max(0, Math.floor(minY - pad)),
    Math.min(100, Math.ceil(maxY + pad)),
  ];

  const skillLabel =
    skillScore < 0.01
      ? "Barely better than a coin flip"
      : `Skill over coin flip ${(skillScore * 100).toFixed(2)}%`;

  return (
    <DoubleBezel>
      <div className="p-6 md:p-8">
        <div className="mb-8 space-y-3">
          <Eyebrow>Trust check</Eyebrow>
          <h2 className="text-2xl font-semibold text-white">
            Can you trust today's %?
          </h2>
          <p className="text-base leading-relaxed text-white/60">
            Green is how often that pick won. Grey is what the model claimed.
            Lines close means trust the board. Lines apart means size down or
            skip.
          </p>
          <div className="flex flex-wrap gap-6 font-mono text-sm text-white/65">
            <span>Correct pick rate {(accuracy * 100).toFixed(1)}%</span>
            <span>{skillLabel}</span>
          </div>
        </div>

        <motion.div
          initial={reduceMotion ? false : { opacity: 0, y: 20 }}
          whileInView={reduceMotion ? undefined : { opacity: 1, y: 0 }}
          viewport={reduceMotion ? undefined : { once: true }}
          transition={
            reduceMotion
              ? undefined
              : { duration: 0.8, ease: [0.32, 0.72, 0, 1] }
          }
          className="h-72 w-full"
        >
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data}>
              <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
              <XAxis
                dataKey="name"
                tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 12 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                domain={domain}
                tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 12 }}
                axisLine={false}
                tickLine={false}
                unit="%"
              />
              <Tooltip
                contentStyle={{
                  background: "#0a0a0a",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 12,
                  fontSize: 14,
                }}
                labelStyle={{ color: "rgba(255,255,255,0.7)" }}
              />
              <Legend wrapperStyle={{ fontSize: 14 }} />
              <Line
                type="monotone"
                dataKey="actual"
                name="Actual win %"
                stroke="#34d399"
                strokeWidth={2.5}
                dot={{ r: 4 }}
              />
              <Line
                type="monotone"
                dataKey="model"
                name="Model %"
                stroke="#94a3b8"
                strokeWidth={2.5}
                strokeDasharray="4 4"
                dot={{ r: 4 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </motion.div>
      </div>
    </DoubleBezel>
  );
}
