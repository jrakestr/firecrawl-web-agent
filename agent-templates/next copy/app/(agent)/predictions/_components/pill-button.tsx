"use client";

import { cn } from "@/utils/cn";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

type PillButtonProps = Omit<ComponentPropsWithoutRef<"button">, "children"> & {
  children: ReactNode;
  /** Selected state for Kelly multiplier toggles. Maps to aria-pressed. */
  active?: boolean;
};

/** Pill button with a nested arrow chip. Don't put links or buttons in children. */
export function PillButton({
  children,
  className,
  type = "button",
  active = false,
  disabled,
  ...buttonProps
}: PillButtonProps) {
  return (
    <button
      {...buttonProps}
      type={type}
      disabled={disabled}
      aria-pressed={active}
      className={cn(
        "group inline-flex items-center gap-3 rounded-full px-7 py-3.5",
        "transition-[transform,opacity,filter] duration-700",
        "ease-[cubic-bezier(0.32,0.72,0,1)]",
        "focus-visible:outline focus-visible:outline-2",
        "focus-visible:outline-offset-2 focus-visible:outline-white",
        "active:scale-[0.98]",
        "motion-reduce:transition-none motion-reduce:active:transform-none",
        "disabled:cursor-not-allowed disabled:opacity-50",
        active
          ? "bg-white text-black enabled:hover:bg-white/90"
          : "bg-white/10 text-white enabled:hover:bg-white/15",
        className,
      )}
    >
      <span className="text-base font-medium tracking-wide">{children}</span>
      <span
        aria-hidden="true"
        className={cn(
          "flex h-9 w-9 items-center justify-center rounded-full text-lg",
          "transition-[transform,opacity] duration-700",
          "ease-[cubic-bezier(0.32,0.72,0,1)]",
          "motion-reduce:transition-none",
          active ? "bg-black/10" : "bg-white/10",
          disabled
            ? undefined
            : "group-hover:translate-x-1 group-hover:-translate-y-px group-hover:scale-105 motion-reduce:group-hover:transform-none",
        )}
      >
        ↗
      </span>
    </button>
  );
}
