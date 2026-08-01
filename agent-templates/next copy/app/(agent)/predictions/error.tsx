"use client";

export default function PredictionsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-6 bg-[#050505] px-4 text-center text-white">
      <p className="text-xs uppercase tracking-[0.16em] text-white/40">
        Predictions error
      </p>
      <h1 className="max-w-lg text-2xl font-medium">
        Could not load MLB data
      </h1>
      <p className="max-w-md text-sm text-white/50">
        {error.message || "Unknown error"}
      </p>
      <button
        type="button"
        onClick={reset}
        className="rounded-full bg-white px-6 py-3 text-sm font-medium text-black transition-transform active:scale-[0.98]"
      >
        Retry
      </button>
    </div>
  );
}
