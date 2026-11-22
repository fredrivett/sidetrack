"use client";

import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { ChangelogEntry, ChangelogPost } from "@/lib/changelog";
import { PostBody, PostDrawing } from "./PostCard";
import { cn } from "@/lib/utils";

const REPO = "https://github.com/fredrivett/sidetrack";

const TYPES = ["new", "improved", "fixed"] as const;
const TYPE_LABEL = { new: "New", improved: "Improved", fixed: "Fixed" } as const;
const TYPE_CLASS = {
  new: "text-blue-700 dark:text-blue-300",
  improved: "text-muted-foreground",
  fixed: "text-amber-700 dark:text-amber-300",
} as const;

// The rail: a hairline down the left, with dots centred on it.
const RAIL = "relative ml-[3.5px] border-l border-neutral-200 pl-5 dark:border-neutral-800";

const dayLabel = (date: string) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

/**
 * The changelog's posts and entries, by day, newest first, with a
 * self-hosters filter (which leaves out posts). A day's post comes first,
 * then its entries grouped as New, Improved and Fixed, each folded until
 * opened.
 */
export function ChangelogFeed({ entries, posts }: { entries: ChangelogEntry[]; posts: ChangelogPost[] }) {
  const [selfHosters, setSelfHosters] = useState(false);
  const shown = selfHosters ? entries.filter((e) => e.for === "self-hosters") : entries;
  const shownPosts = selfHosters ? [] : posts;
  const days = [...new Set([...shownPosts, ...shown].map((e) => e.date))].sort().reverse();

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Changelog</h1>
          <p className="mt-1 text-sm text-muted-foreground">What&apos;s new in Sidetrack.</p>
        </div>
        <div className="flex gap-1" role="group" aria-label="Show">
          {[
            { on: false, label: "All" },
            { on: true, label: "Self-hosters" },
          ].map(({ on, label }) => (
            <Button
              key={label}
              size="sm"
              variant={selfHosters === on ? "secondary" : "ghost"}
              aria-pressed={selfHosters === on}
              onClick={() => setSelfHosters(on)}
            >
              {label}
            </Button>
          ))}
        </div>
      </div>

      {days.length === 0 && (
        <p className="text-sm text-muted-foreground">Nothing here yet.</p>
      )}
      {/* A timeline: one rail down the page, a dot per entry. From sm, each
          day's date sits in a column beside its entries; on phones it's a
          node on the rail, labelled above them. */}
      {days.map((day) => {
        const dayEntries = shown.filter((e) => e.date === day);
        const count = dayEntries.length
          ? `${dayEntries.length} ${dayEntries.length === 1 ? "change" : "changes"}`
          : "";
        return (
          <section key={day} className="sm:grid sm:grid-cols-[7.5rem_1fr] sm:gap-6">
            <h2 className={cn(RAIL, "pb-3 sm:ml-0 sm:border-0 sm:pl-0 sm:pt-0.5")}>
              <span
                aria-hidden
                className="absolute -left-[5.5px] top-[5px] size-2.5 rounded-full bg-foreground sm:hidden"
              />
              <time dateTime={day} className="text-sm font-medium">
                {dayLabel(day)}
              </time>
              <span className="ml-2 text-xs text-muted-foreground sm:ml-0 sm:block">{count}</span>
            </h2>
            <ol className={cn(RAIL, "pb-6")}>
              {shownPosts
                .filter((p) => p.date === day)
                .map((p) => (
                  <li key={p.slug} className="relative pb-6">
                    <span
                      aria-hidden
                      // A bigger ring than an entry's, in the text colour, so it
                      // doesn't read as a second day on phones.
                      className="absolute -left-[26.5px] top-[5px] size-3 rounded-full border-2 border-foreground bg-neutral-50 dark:bg-neutral-950"
                    />
                    <article className="rounded-xl border border-border bg-background p-4 shadow-sm">
                      {p.image && <PostDrawing image={p.image} className="mb-3 w-full max-w-72" />}
                      <h3 className="text-base font-semibold tracking-tight">{p.title}</h3>
                      <PostBody post={p} className="mt-2 text-sm" />
                    </article>
                  </li>
                ))}
              {TYPES.map((type) => {
                const group = dayEntries.filter((e) => e.type === type);
                if (group.length === 0) return null;
                return (
                  <li key={type} className="relative pb-2 last:pb-0">
                    {/* Folded until opened, so a busy day is three lines. */}
                    <details className="group">
                    <summary
                      className={cn(
                        "relative -mx-1.5 inline-flex cursor-pointer list-none items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium select-none hover:bg-muted [&::-webkit-details-marker]:hidden",
                        TYPE_CLASS[type],
                      )}
                    >
                      <span
                        aria-hidden
                        className={cn(
                          "absolute top-1/2 -left-[18.5px] size-2 -translate-y-1/2 rounded-full border-[1.5px] border-current bg-neutral-50 dark:bg-neutral-950",
                          TYPE_CLASS[type],
                        )}
                      />
                      {TYPE_LABEL[type]} <span className="text-muted-foreground">{group.length}</span>
                      <ChevronRight aria-hidden className="size-3.5 text-muted-foreground transition-transform group-open:rotate-90" />
                    </summary>
                    <ul className="mt-1.5 space-y-3">
                      {group.map((e) => (
                        <li key={e.file} className="text-sm">
                          <p className="text-pretty">{e.text}</p>
                          {e.media && <Media file={e.media} />}
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {e.pr.map((n, i) => (
                              <span key={n}>
                                {i > 0 && " "}
                                <a href={`${REPO}/pull/${n}`} className="hover:text-foreground hover:underline">
                                  #{n}
                                </a>
                              </span>
                            ))}
                            {e.for === "self-hosters" && " · for self-hosters"}
                          </p>
                        </li>
                      ))}
                    </ul>
                    </details>
                  </li>
                );
              })}
            </ol>
          </section>
        );
      })}
    </div>
  );
}

function Media({ file }: { file: string }) {
  const src = `/changelog/${file}`;
  const className = "mt-2 w-full rounded-lg border border-neutral-200 dark:border-neutral-800";
  return file.endsWith(".mp4") ? (
    <video src={src} className={className} autoPlay loop muted playsInline />
  ) : (
    // eslint-disable-next-line @next/next/no-img-element -- static files in public/, any size
    <img src={src} alt="" className={className} loading="lazy" />
  );
}
