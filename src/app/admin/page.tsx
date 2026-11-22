import Link from "next/link";
import { LogoMark } from "@/components/LogoMark";
import { RelativeTime } from "@/components/RelativeTime";
import { UserAvatar } from "@/components/UserAvatar";
import { requireAdmin } from "@/auth/session";
import { getDb } from "@/core/db";
import { dailyUsage } from "@/core/usage";
import { getTimeZone } from "@/core/users";

export const dynamic = "force-dynamic";

const DAYS = 90;
/** Each day's column, in px: its square plus the gap to the next. */
const CELL = 11;
const SQUARE = 9;

/**
 * How dark a day's square is, in four steps like GitHub's contribution
 * graph: on a square-root scale, so quiet days still differ from none.
 */
function shade(n: number, busiest: number): number {
  return [0.25, 0.5, 0.75, 1][Math.ceil(4 * Math.sqrt(n / busiest)) - 1];
}

/** "Tue 3 Nov" for a YYYY-MM-DD. */
function dayLabel(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

/** What a row's squares say, for screen readers. */
function summary(perDay: number[]): string {
  const total = perDay.reduce((sum, n) => sum + n, 0);
  if (total === 0) return `No changes in the last ${DAYS} days`;
  const active = perDay.filter(Boolean).length;
  return `${total} change${total === 1 ? "" : "s"} on ${active} of the last ${DAYS} days`;
}

export default async function AdminPage() {
  const adminId = await requireAdmin();
  const { db } = getDb();
  const timeZone = getTimeZone(db, adminId) ?? "UTC";
  const { days, users } = dailyUsage(db, { days: DAYS, timeZone });
  // A loop, not Math.max(...all): spreading 90 counts per person runs out of
  // stack at a thousand or so people.
  let busiest = 1;
  for (const user of users) for (const n of user.perDay) if (n > busiest) busiest = n;
  const dayOf = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  const activeIn = (n: number) => users.filter((u) => u.perDay.slice(-n).some(Boolean)).length;
  const grid = { gridTemplateColumns: `repeat(${DAYS}, ${CELL}px)` };

  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex w-full max-w-7xl items-center px-4 py-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <LogoMark />
          Sidetrack
        </Link>
      </header>
      <main className="mx-auto max-w-7xl space-y-6 px-4 pb-16 sm:px-6">
        <header className="space-y-1">
          <h1 className="text-lg font-semibold tracking-tight">Usage</h1>
          <p className="text-sm text-muted-foreground">
            Changes each person made per day, from the web or through an agent, over the last {DAYS} days
            ({timeZone}). Darker squares are busier days.
          </p>
        </header>

        <dl className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
          {[
            ["People", users.length],
            ["Active today", activeIn(1)],
            ["Active this week", activeIn(7)],
            [`Active in ${DAYS} days`, activeIn(DAYS)],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="text-lg font-semibold tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>

        {/* Right to left, so a narrow screen starts scrolled to today. */}
        <div className="overflow-x-auto rounded-lg border border-border bg-background" dir="rtl">
          <table className="w-full border-collapse text-sm" dir="ltr">
            <thead>
              <tr className="border-b border-border text-xs text-muted-foreground">
                <th className="sticky left-0 z-10 bg-background px-3 py-2 text-left font-medium">Person</th>
                <th className="px-3 py-2 font-normal">
                  {/* Each month's name over its first day, and over the first
                      day shown unless a month starts right after it. */}
                  <div className="grid" style={grid} aria-hidden>
                    {days.map((day, i) =>
                      (i === 0 && !days.slice(1, 7).some((d) => d.endsWith("-01"))) || (i > 0 && day.endsWith("-01")) ? (
                        <span
                          key={day}
                          className="whitespace-nowrap text-left"
                          style={{ gridColumn: `${i + 1} / span 7` }}
                        >
                          {new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", { timeZone: "UTC", month: "short" })}
                        </span>
                      ) : null,
                    )}
                  </div>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {users.map((user) => {
                const joined = dayOf.format(user.createdAt);
                return (
                  <tr key={user.id}>
                    <td className="sticky left-0 z-10 bg-background px-3 py-2">
                      <div className="flex w-48 items-center gap-2">
                        <UserAvatar
                          user={{
                            userId: user.id,
                            displayUsername: user.username,
                            name: user.name,
                            email: user.email,
                            image: user.image,
                          }}
                          size={24}
                        />
                        <div className="min-w-0" title={`${user.email}, joined ${dayLabel(joined)}`}>
                          <div className="truncate">
                            <span className="font-medium">{user.name}</span>{" "}
                            <span className="text-xs text-muted-foreground">@{user.username}</span>
                          </div>
                          <div className="truncate text-xs text-muted-foreground">
                            {user.lastActiveAt === null ? (
                              "No changes yet"
                            ) : (
                              <>
                                <span className="tabular-nums">{user.total}</span> change{user.total === 1 ? "" : "s"} · last{" "}
                                <RelativeTime ts={user.lastActiveAt} />
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      {/* One picture with one summary for screen readers; each
                          square's date and count show on hover. */}
                      <div className="grid items-center" style={grid} role="img" aria-label={summary(user.perDay)}>
                        {user.perDay.map((n, i) => {
                          const day = days[i];
                          // No square before they signed up, so joining shows as where the row starts.
                          if (day < joined) return <span key={day} />;
                          const label = `${dayLabel(day)}: ${n} change${n === 1 ? "" : "s"}`;
                          return (
                            <span key={day} title={label} className="flex h-5 items-center">
                              <span
                                className={n ? "rounded-[2px] bg-foreground" : "rounded-[2px] bg-muted-foreground/15"}
                                style={{ width: SQUARE, height: SQUARE, opacity: n ? shade(n, busiest) : undefined }}
                              />
                            </span>
                          );
                        })}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
