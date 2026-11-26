import { ArrowLeft, ArrowUpRight, Bell, CalendarDays, KeyRound, Mail, ShieldCheck, Users } from "lucide-react";
import type { UserUsage } from "@/core/usage";
import Link from "next/link";
import { LogoMark } from "@/components/LogoMark";
import { UserAvatar } from "@/components/UserAvatar";
import { requireAdmin } from "@/auth/session";
import { aiSpend } from "@/core/aiUsage";
import { getDb } from "@/core/db";
import { isLooking } from "@/core/presence";
import { cohorts, dailyUsage } from "@/core/usage";
import { getTimeZone } from "@/core/users";
import { getEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

const DAYS = 90;
/** Weeks in the stats' charts: as many as fit in DAYS. */
const WEEKS = 12;
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

const DAY_MS = 86_400_000;

/**
 * When someone was last around, to the day: a web session notes its use at
 * most once a day, so anything finer would claim more than is known.
 */
function seenLabel(ts: number | null, now: number): string {
  if (ts === null) return "Never seen";
  const days = Math.floor((now - ts) / DAY_MS);
  return days < 1 ? "Seen <1d ago" : `Seen ${days}d ago`;
}

/** What a row's squares say, for screen readers. */
function summary(perDay: number[]): string {
  const total = perDay.reduce((sum, n) => sum + n, 0);
  if (total === 0) return `No changes in the last ${DAYS} days`;
  const active = perDay.filter(Boolean).length;
  return `${total} change${total === 1 ? "" : "s"} on ${active} of the last ${DAYS} days`;
}

/** A share as a percentage, never "0%" for something that isn't none. */
function percent(part: number, whole: number): string {
  const p = Math.round((100 * part) / whole);
  return p === 0 && part > 0 ? "<1%" : `${p}%`;
}

/** Days of AI spend shown: the stat, each person's and the features'. */
const AI_DAYS = 30;

/** What asked the AI, by the feature name aiFetch records. */
const AI_FEATURES: Record<string, string> = {
  greeting: "Agenda greeting",
  newItem: "New item suggestions",
  listIcons: "List icon suggestions",
  listIcon: "List icons on save",
  labelEmoji: "Label emoji suggestions",
  labelEmojiOnSave: "Label emoji on save",
  dayTags: "Day note tags",
  feedbackFollowUps: "Feedback follow-ups",
  prioritySort: "Sort by priority",
};

/**
 * Dollars, with as many places as small sums need: cheap models make a
 * month's spend a fraction of a cent, which "$0.00" would hide.
 */
function dollars(usd: number): string {
  if (usd === 0) return "$0";
  if (usd < 0.0001) return "<$0.0001";
  if (usd < 0.01) return `$${usd.toPrecision(2)}`;
  return `$${usd.toFixed(usd < 1 ? 3 : usd < 100 ? 2 : 0)}`;
}

/** A token count, short: 950, 12.3k, 4.1M. */
function tokenCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/** A headline number, with what it's out of and, optionally, a small chart. */
function Stat({ label, value, note, children }: { label: string; value: string | number; note?: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col justify-between gap-3 bg-background p-4">
      <div>
        <div className="text-xs font-medium text-muted-foreground">{label}</div>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="text-3xl font-semibold tracking-tight tabular-nums">{value}</span>
          {note && <span className="text-xs text-muted-foreground">{note}</span>}
        </div>
      </div>
      {children}
    </div>
  );
}

/** Small bars, oldest first, the last one (now) in full colour. */
function Bars({
  values,
  labels,
  label,
  format = String,
}: {
  values: number[];
  labels: string[];
  label: string;
  format?: (n: number) => string;
}) {
  // The tallest bar fills the chart, even when it's a few cents.
  const top = Math.max(...values) || 1;
  return (
    <div className="flex h-8 items-end gap-px" role="img" aria-label={`${label}: ${values.map(format).join(", ")}`}>
      {values.map((n, i) => (
        <span
          key={labels[i]}
          title={labels[i]}
          className={i === values.length - 1 ? "flex-1 bg-foreground" : "flex-1 bg-muted-foreground/40"}
          style={{ height: n ? `${Math.max(8, (100 * n) / top)}%` : "2px" }}
        />
      ))}
    </div>
  );
}

/** What each person has set up, as small icons; only what's on shows. */
function Features({ features }: { features: UserUsage["features"] }) {
  const on = [
    features.agentKeys > 0 && { Icon: KeyRound, label: `${features.agentKeys} agent key${features.agentKeys === 1 ? "" : "s"}`, agent: true },
    features.sharing && { Icon: Users, label: "Shares lists" },
    features.push && { Icon: Bell, label: "Push notifications" },
    features.emailIn && { Icon: Mail, label: "Email in" },
    features.calendars && { Icon: CalendarDays, label: "Calendars" },
    features.twoFactor && { Icon: ShieldCheck, label: "Two-factor" },
  ].filter((f) => f !== false);
  if (!on.length) return null;
  return (
    <span className="flex items-center gap-1">
      {on.map(({ Icon, label, agent }) => (
        <span key={label} title={label} className={agent ? "text-violet-600 dark:text-violet-300" : undefined}>
          <Icon className="size-3" aria-hidden />
          <span className="sr-only">, {label}</span>
        </span>
      ))}
    </span>
  );
}

/** A plain square, as in the grid, for the legend. */
function Swatch({ style }: { style: React.CSSProperties }) {
  return <span className="inline-block" style={{ width: SQUARE, height: SQUARE, ...style }} />;
}

export default async function AdminPage() {
  const adminId = await requireAdmin();
  const { db } = getDb();
  const timeZone = getTimeZone(db, adminId) ?? "UTC";
  const usage = dailyUsage(db, { days: DAYS, timeZone });
  // PostHog knows people by their user id (PostHogIdentify), so this opens
  // their events and replays.
  const posthog = getEnv().POSTHOG_PROJECT_URL;
  const { now, days, users } = usage;
  // A loop, not Math.max(...all): spreading 90 counts per person runs out of
  // stack at a thousand or so people.
  let busiest = 1;
  for (const user of users) for (const n of user.perDay) if (n > busiest) busiest = n;
  const activeIn = (n: number) => users.filter((u) => u.perDay.slice(-n).some(Boolean)).length;
  const share = (n: number) => (users.length ? `${Math.round((100 * n) / users.length)}% of people` : undefined);
  const dailyActive = days.map((_, i) => users.filter((u) => u.perDay[i] > 0).length);
  const recent = dailyActive.slice(-30);
  // Weeks of 7 days ending today, oldest first.
  const weekly = Array.from({ length: WEEKS }, (_, w) => {
    const from = DAYS - 7 * (WEEKS - w);
    return users.filter((u) => u.perDay.slice(from, from + 7).some(Boolean)).length;
  });
  // Who joined in those same weeks, and how many kept going.
  const weeks = cohorts(usage, WEEKS);
  const signups = weeks.map((c) => c.joined);
  const newPeople = users.filter((u) => now - u.createdAt < 30 * DAY_MS).length;
  const total = users.reduce((sum, u) => sum + u.total, 0);
  const agentTotal = users.reduce((sum, u) => sum + u.agentTotal, 0);
  const grid = { gridTemplateColumns: `repeat(${DAYS}, ${CELL}px)` };
  // Grey (all in the app) to violet (all through agents), like agents' avatars.
  const fill = (agentShare: number) => `color-mix(in oklab, var(--agent) ${Math.round(100 * agentShare)}%, var(--foreground))`;
  // UTC days, as the AI's usage is kept.
  const aiDays = Array.from({ length: AI_DAYS }, (_, i) => new Date(now - (AI_DAYS - 1 - i) * DAY_MS).toISOString().slice(0, 10));
  const ai = aiSpend(db, aiDays[0]);
  const aiPerDay = aiDays.map((d) => ai.byDay.get(d)?.cost ?? 0);
  const aiFeatures = [...ai.byFeature].sort((a, b) => b[1].cost - a[1].cost || b[1].calls - a[1].calls);
  const aiNotes = [
    ...Object.entries(ai.unconfirmed).map(([model, why]) => `${model}: price unconfirmed (${why.toLowerCase()}), so the last known one is used`),
    ...ai.unpriced.map((model) => `${model}: no price, so it counts as free`),
  ];

  return (
    <div className="min-h-dvh bg-neutral-50 dark:bg-neutral-950">
      <header className="border-b border-border bg-background">
        <div className="mx-auto flex w-full max-w-[84rem] items-center gap-3 px-4 py-3 sm:px-6">
          <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <LogoMark />
            Sidetrack
          </Link>
          <span className="border border-border px-2 py-0.5 text-xs font-medium text-muted-foreground">Admin</span>
          <Link
            href="/"
            className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline"
          >
            <ArrowLeft className="size-3.5" />
            Back to board
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-[84rem] space-y-8 px-4 py-8 sm:px-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Usage</h1>
          <p className="text-sm text-muted-foreground">
            Who&apos;s using Sidetrack, day by day over the last {DAYS} days, in {timeZone}.
          </p>
        </header>

        {/* One strip, 1px lines between the stats. */}
        <section className="grid grid-cols-2 gap-px border border-border bg-border lg:grid-cols-5">
          <Stat label="People" value={users.length} note={newPeople ? `+${newPeople} in 30 days` : undefined}>
            <Bars
              values={signups}
              labels={signups.map((n, i) => `${dayLabel(days[DAYS - 7 * (WEEKS - i)])} week: ${n} joined`)}
              label={`People who joined each week over the last ${WEEKS} weeks`}
            />
          </Stat>
          <Stat label="Active today" value={activeIn(1)} note={share(activeIn(1))}>
            <Bars
              values={recent}
              labels={recent.map((n, i) => `${dayLabel(days[DAYS - 30 + i])}: ${n} active`)}
              label="People active each day over the last 30 days"
            />
          </Stat>
          <Stat label="Active this week" value={activeIn(7)} note={share(activeIn(7))}>
            <Bars
              values={weekly}
              labels={weekly.map((n, i) => `${dayLabel(days[DAYS - 7 * (WEEKS - i)])} week: ${n} active`)}
              label={`People active each week over the last ${WEEKS} weeks`}
            />
          </Stat>
          <Stat
            label="Through agents"
            value={total ? percent(agentTotal, total) : "–"}
            note={`of ${total} change${total === 1 ? "" : "s"}`}
          >
            {/* The split itself, app then agents. */}
            <div className="flex h-2 overflow-hidden bg-muted-foreground/40" aria-hidden>
              <span className="ml-auto bg-violet-600 dark:bg-violet-400" style={{ width: `${total ? (100 * agentTotal) / total : 0}%` }} />
            </div>
          </Stat>
          <div className="col-span-2 grid lg:col-span-1">
            <Stat
              label={`AI spend, ${AI_DAYS} days`}
              value={dollars(ai.total.cost)}
              note={`${tokenCount(ai.total.tokens)} tokens`}
            >
              <Bars
                values={aiPerDay}
                labels={aiPerDay.map((usd, i) => `${dayLabel(aiDays[i])}: ${dollars(usd)}`)}
                label={`AI spend each day over the last ${AI_DAYS} days`}
                format={dollars}
              />
            </Stat>
          </div>
        </section>

        <section className="overflow-hidden border border-border bg-background">
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold">People</h2>
            <div
              className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-muted-foreground [--agent:var(--color-violet-600)] dark:[--agent:var(--color-violet-400)]"
              aria-hidden
            >
              <span className="flex items-center gap-1">
                Fewer changes
                {[0.25, 0.5, 0.75, 1].map((opacity) => (
                  <Swatch key={opacity} style={{ opacity, backgroundColor: fill(0) }} />
                ))}
                More
              </span>
              <span className="flex items-center gap-1">
                App
                {[0, 0.25, 0.5, 0.75, 1].map((agentShare) => (
                  <Swatch key={agentShare} style={{ opacity: 0.75, backgroundColor: fill(agentShare) }} />
                ))}
                Agents
              </span>
            </div>
          </div>

          {/* Right to left, so a narrow screen starts scrolled to today. */}
          <div className="overflow-x-auto" dir="rtl">
            <table className="w-full border-collapse text-sm" dir="ltr">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="sticky left-0 z-10 bg-background px-4 py-2 text-left font-medium">Person</th>
                  <th className="py-2 pr-4 font-normal">
                    {/* Each month's name over its first day, and over the first
                        day shown unless a month starts right after it. */}
                    <div className="grid" style={grid} aria-hidden>
                      {days.map((day, i) =>
                        (i === 0 && !days.slice(1, 7).some((d) => d.endsWith("-01"))) || (i > 0 && day.endsWith("-01")) ? (
                          <span
                            key={day}
                            className="border-l border-border pl-1 text-left whitespace-nowrap"
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
                  const joined = user.joinedOn;
                  const here = isLooking(user.id);
                  const spent = ai.byUser.get(user.id);
                  return (
                    // The signup notice links here (#@username), so the row it names stands out.
                    <tr key={user.id} id={`@${user.username.toLowerCase()}`} className="group scroll-mt-24">
                      <td className="sticky left-0 z-10 bg-background px-4 py-3 group-hover:bg-muted group-target:bg-amber-100 dark:group-target:bg-amber-950">
                        <div className="flex w-52 items-center gap-3">
                          <span className="relative shrink-0">
                            <UserAvatar
                              user={{
                                userId: user.id,
                                displayUsername: user.username,
                                name: user.name,
                                email: user.email,
                                image: user.image,
                              }}
                              size={32}
                            />
                            {here && (
                              <span className="absolute -right-0.5 -bottom-0.5 size-3 rounded-full bg-green-500 ring-2 ring-background" />
                            )}
                          </span>
                          <div className="min-w-0 space-y-0.5" title={`${user.email}, joined ${dayLabel(joined)}`}>
                            <div className="truncate leading-tight">
                              <span className="font-medium">{user.name}</span>{" "}
                              <span className="text-xs text-muted-foreground">@{user.username}</span>
                            </div>
                            <div className="truncate text-xs text-muted-foreground">
                              {user.total === 0 ? (
                                "No changes"
                              ) : (
                                <>
                                  <span className="font-medium text-foreground tabular-nums">{user.total}</span> change
                                  {user.total === 1 ? "" : "s"}
                                </>
                              )}
                              {user.agentTotal > 0 && (
                                <>
                                  {" · "}
                                  <span className="text-violet-600 dark:text-violet-300" title={user.agents.length ? `Through ${user.agents.join(", ")}` : undefined}
                                  >
                                    {percent(user.agentTotal, user.total)} agents
                                  </span>
                                </>
                              )}
                            </div>
                            <div className="truncate text-xs text-muted-foreground">
                              {here ? <span className="text-green-700 dark:text-green-400">Here now</span> : seenLabel(user.lastSeenAt, now)}
                              {posthog && (
                                <>
                                  {" · "}
                                  <a
                                    href={`${posthog}/person/${encodeURIComponent(user.id)}`}
                                    target="_blank"
                                    rel="noreferrer noopener"
                                    aria-label={`${user.name} in PostHog`}
                                    className="inline-flex items-center underline-offset-2 hover:text-foreground hover:underline"
                                  >
                                    PostHog
                                    <ArrowUpRight className="size-3" />
                                  </a>
                                </>
                              )}
                            </div>
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                              <span className="whitespace-nowrap">
                                {user.lists} list{user.lists === 1 ? "" : "s"} · {user.openItems} open
                              </span>
                              <Features features={user.features} />
                            </div>
                            {spent && (
                              <div
                                className="truncate text-xs text-muted-foreground"
                                title={`${spent.calls} AI call${spent.calls === 1 ? "" : "s"} in the last ${AI_DAYS} days`}
                              >
                                AI <span className="font-medium text-foreground tabular-nums">{dollars(spent.cost)}</span> ·{" "}
                                {tokenCount(spent.tokens)} tokens
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="py-3 pr-4 group-hover:bg-muted/50 group-target:bg-amber-100/60 dark:group-target:bg-amber-950/60">
                        {/* One picture with one summary for screen readers; each
                            square's date and count show on hover. */}
                        <div
                          className="grid items-center [--agent:var(--color-violet-600)] dark:[--agent:var(--color-violet-400)]"
                          style={grid}
                          role="img"
                          aria-label={summary(user.perDay)}
                        >
                          {user.perDay.map((n, i) => {
                            const day = days[i];
                            // No square before they signed up, so joining shows as where the row starts.
                            if (day < joined) return <span key={day} />;
                            const agent = user.agentPerDay[i];
                            const label = `${dayLabel(day)}: ${n} change${n === 1 ? "" : "s"}${agent ? `, ${agent} through agents` : ""}`;
                            return (
                              <span key={day} title={label} className="flex h-5 items-center">
                                <span
                                  className={n ? undefined : "bg-muted-foreground/15"}
                                  style={{
                                    width: SQUARE,
                                    height: SQUARE,
                                    opacity: n ? shade(n, busiest) : undefined,
                                    backgroundColor: n ? fill(agent / n) : undefined,
                                  }}
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
        </section>

        <section className="overflow-hidden border border-border bg-background">
          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold">AI spend</h2>
            <p className="text-xs text-muted-foreground">
              What asked Claude and Jev over the last {AI_DAYS} days, priced at each day&apos;s published rates.
              {ai.checkedAt !== null &&
                ` Prices checked ${now - ai.checkedAt < DAY_MS ? "today" : `${Math.floor((now - ai.checkedAt) / DAY_MS)}d ago`}.`}
            </p>
          </div>
          {aiFeatures.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">No AI calls in the last {AI_DAYS} days.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border text-xs text-muted-foreground">
                    <th className="px-4 py-2 text-left font-medium">Feature</th>
                    <th className="px-3 py-2 text-right font-medium">Calls</th>
                    <th className="px-3 py-2 text-right font-medium">Tokens</th>
                    <th className="px-3 py-2 text-right font-medium">Cost</th>
                    <th className="hidden w-1/3 px-4 py-2 text-left font-medium sm:table-cell">Share</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {aiFeatures.map(([feature, s]) => (
                    <tr key={feature}>
                      <td className="px-4 py-2">{AI_FEATURES[feature] ?? feature}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{s.calls}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{tokenCount(s.tokens)}</td>
                      <td className="px-3 py-2 text-right font-medium tabular-nums">{dollars(s.cost)}</td>
                      <td className="hidden px-4 py-2 sm:table-cell">
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <div className="h-2 flex-1 bg-muted-foreground/15" aria-hidden>
                            <div
                              className="h-full bg-foreground"
                              style={{ width: `${ai.total.cost ? (100 * s.cost) / ai.total.cost : 0}%` }}
                            />
                          </div>
                          <span className="w-9 text-right tabular-nums">
                            {ai.total.cost ? percent(s.cost, ai.total.cost) : "–"}
                          </span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {aiNotes.length > 0 && (
            <ul className="space-y-0.5 border-t border-border px-4 py-2 text-xs text-muted-foreground">
              {aiNotes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          )}
        </section>

        <section className="overflow-hidden border border-border bg-background">
          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold">Retention</h2>
            <p className="text-xs text-muted-foreground">
              Of the people who joined each week, the share who made a change 1, 2, 3… weeks on.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="text-xs text-muted-foreground">
                  <th className="sticky left-0 z-10 border-r border-b border-border bg-background px-4 py-2 text-left font-medium whitespace-nowrap">
                    Joined
                  </th>
                  <th className="border-r border-b border-border px-3 py-2 text-right font-medium">People</th>
                  {weeks.map((_, k) => (
                    <th
                      key={k}
                      className="border-r border-b border-border px-2 py-2 text-center font-medium whitespace-nowrap last:border-r-0"
                    >
                      {k === 0 ? "Wk 0" : `+${k}`}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {weeks.map((cohort) => (
                  // Fixed height, so a row with no cells yet is as tall as the rest.
                  <tr key={cohort.week} className="h-9">
                    <td className="sticky left-0 z-10 border-r border-b border-border bg-background px-4 py-0 whitespace-nowrap text-muted-foreground">
                      Week of{" "}
                      {new Date(`${cohort.week}T00:00:00Z`).toLocaleDateString("en-GB", { timeZone: "UTC", day: "numeric", month: "short" })}
                    </td>
                    <td className="border-r border-b border-border px-3 py-0 text-right font-medium tabular-nums">{cohort.joined || "–"}</td>
                    {weeks.map((_, k) => {
                      const cell = cohort.joined ? cohort.active[k] : undefined;
                      const share = cell ? cell.kept / cell.of : cell;
                      const title =
                        cell === null
                          ? "This week isn't over yet"
                          : cell === undefined
                            ? undefined
                            : `${cell.kept} of ${cell.of}${cell.of < cohort.joined ? `; the other ${cohort.joined - cell.of} haven't finished this week` : ""}`;
                      // Flush cells, darker for more of them still around, numbers on top.
                      return (
                        <td
                          key={k}
                          title={title}
                          className={
                            cell === undefined
                              ? "border-r border-b border-border p-0 last:border-r-0"
                              : "h-9 min-w-14 border-r border-b border-border p-0 text-center text-xs tabular-nums last:border-r-0"
                          }
                          style={share ? { backgroundColor: `color-mix(in oklab, var(--foreground) ${Math.round(6 + 84 * share)}%, var(--background))` } : undefined}
                        >
                          {cell === null ? (
                            <span className="text-muted-foreground">…</span>
                          ) : cell === undefined ? null : (
                            <span
                              // Light text only on fills dark enough to keep it readable.
                              className={cell.kept / cell.of > 0.55 ? "font-medium text-background" : cell.kept === 0 ? "text-muted-foreground" : ""}
                            >
                              {percent(cell.kept, cell.of)}
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}
