export default function PredictionsLoading() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-[#050505] text-white/50">
      <div className="space-y-4 text-center">
        <div className="mx-auto h-10 w-10 animate-pulse rounded-full border border-emerald-400/30 bg-emerald-400/10" />
        <p className="text-base tracking-[0.16em] uppercase">Loading…</p>
      </div>
    </div>
  );
}
