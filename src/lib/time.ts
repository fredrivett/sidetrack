export function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  const min = 60_000;
  const hr = 60 * min;
  const day = 24 * hr;
  if (diff < min) return "just now";
  if (diff < hr) return `${Math.floor(diff / min)}m ago`;
  if (diff < day) return `${Math.floor(diff / hr)}h ago`;
  return `${Math.floor(diff / day)}d ago`;
}

/** Verbose relative time for agent/MCP output: "just now", "5 minutes ago", "7 months ago". */
export function formatRelativeLong(ts: number): string {
  const diff = Date.now() - ts;
  const min = 60_000;
  const hr = 60 * min;
  const day = 24 * hr;
  const week = 7 * day;
  const month = 30 * day;
  const year = 365 * day;
  const ago = (n: number, unit: string) =>
    `${n} ${unit}${n === 1 ? "" : "s"} ago`;
  if (diff < min) return "just now";
  if (diff < hr) return ago(Math.floor(diff / min), "minute");
  if (diff < day) return ago(Math.floor(diff / hr), "hour");
  if (diff < week) return ago(Math.floor(diff / day), "day");
  if (diff < month) return ago(Math.floor(diff / week), "week");
  if (diff < year) return ago(Math.floor(diff / month), "month");
  return ago(Math.floor(diff / year), "year");
}

/**
 * Hour (local time) at which "today" turns over. Items ticked off at 1am
 * still count as part of the evening before, so 4am rather than midnight.
 */
export const DAY_START_HOUR = 4;

/**
 * Start of the "today" that `now` falls in, in the runtime's local timezone:
 * the most recent DAY_START_HOUR at or before `now`. Each device uses its own
 * current timezone, so a traveller's day follows them.
 */
export function startOfDay(now: number): number {
  const d = new Date(now);
  const start = new Date(
    d.getFullYear(),
    d.getMonth(),
    d.getDate(),
    DAY_START_HOUR,
  );
  if (start.getTime() > now) start.setDate(start.getDate() - 1);
  return start.getTime();
}

/** The next turnover after `now`: when startOfDay(now) next changes. */
export function nextDayStart(now: number): number {
  const d = new Date(startOfDay(now));
  d.setDate(d.getDate() + 1);
  return d.getTime();
}

/** Local calendar-day bucket label: "Today", "Yesterday", else "16 May 2026". */
export function dayLabel(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const startOf = (x: Date) =>
    new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const dayMs = 24 * 60 * 60 * 1000;
  const delta = Math.round((startOf(today) - startOf(d)) / dayMs);
  if (delta === 0) return "Today";
  if (delta === 1) return "Yesterday";
  return d.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
