import { cn } from "@/utils/cn";
import type { ReactNode } from "react";

/** Outer ring + inner panel. Pass className for the shell, innerClassName for the panel. */
export function DoubleBezel({
  children,
  className,
  innerClassName,
}: {
  children: ReactNode;
  className?: string;
  innerClassName?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-[2rem] border border-white/5 bg-white/5 p-2",
        className,
      )}
    >
      <div
        className={cn(
          "rounded-[1.5rem] border border-white/10 bg-[#0a0a0a]",
          "shadow-[inset_0_1px_1px_rgba(255,255,255,0.1)]",
          innerClassName,
        )}
      >
        {children}
      </div>
    </div>
  );
}

/** Small uppercase label above a section title. */
export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex rounded-full border border-white/10 bg-white/5 px-3.5 py-1.5 text-xs font-medium uppercase tracking-[0.18em] text-white/65">
      {children}
    </span>
  );
}
