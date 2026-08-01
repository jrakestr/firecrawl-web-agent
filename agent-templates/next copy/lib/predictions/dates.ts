/** Calendar date in America/New_York as YYYY-MM-DD (matches mlb_predictions.date). */
export function todayInNewYork(now = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

/** Stable short date for SSR + client (fixed locale + timezone). */
export function formatNyDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).format(new Date(iso));
}
