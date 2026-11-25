"use client";

import { useId, useRef, useState } from "react";
import type { AssigneeView } from "@/core/members";
import {
  cutTitle,
  type PlacedPart,
  placeParts,
  ruleParts,
  type TitleField as Field,
  type TitlePart,
} from "@/lib/titleParts";
import { cn } from "@/lib/utils";
import { Struck } from "./Struck";
import { assigneeName } from "./UserAvatar";

/**
 * The colour of each field a title part sets, shared by its words in the
 * title and the chip it fills, so it's clear which words set which field.
 * `dot` marks the part in the panel under the title, and `gap` is the tint
 * as a colour, for the band around a struck word's line.
 */
export const PART_TONE: Record<Field, { text: string; dot: string; gap: string; chip: string }> = {
  due: {
    text: "bg-blue-500/15",
    dot: "bg-blue-500",
    gap: "[--strike-gap:color-mix(in_oklab,var(--color-blue-500)_15%,var(--color-popover))]",
    chip: "border-transparent bg-blue-500/12 [&_svg]:text-blue-600 dark:[&_svg]:text-blue-400",
  },
  repeat: {
    text: "bg-violet-500/15",
    dot: "bg-violet-500",
    gap: "[--strike-gap:color-mix(in_oklab,var(--color-violet-500)_15%,var(--color-popover))]",
    chip: "border-transparent bg-violet-500/12 [&_svg]:text-violet-600 dark:[&_svg]:text-violet-400",
  },
  who: {
    text: "bg-emerald-500/15",
    dot: "bg-emerald-500",
    gap: "[--strike-gap:color-mix(in_oklab,var(--color-emerald-500)_15%,var(--color-popover))]",
    chip: "border-transparent bg-emerald-500/12 [&_svg]:text-emerald-600 dark:[&_svg]:text-emerald-400",
  },
  label: {
    text: "bg-amber-500/15",
    dot: "bg-amber-500",
    gap: "[--strike-gap:color-mix(in_oklab,var(--color-amber-500)_15%,var(--color-popover))]",
    chip: "border-transparent bg-amber-500/12 [&_svg]:text-amber-600 dark:[&_svg]:text-amber-400",
  },
  list: {
    text: "bg-sky-500/15",
    dot: "bg-sky-500",
    gap: "[--strike-gap:color-mix(in_oklab,var(--color-sky-500)_15%,var(--color-popover))]",
    chip: "border-transparent bg-sky-500/12 [&_svg]:text-sky-600 dark:[&_svg]:text-sky-400",
  },
  filler: { text: "", dot: "bg-neutral-400", gap: "", chip: "" },
};

const FIELD_NAME: Record<Field, string> = {
  due: "due date",
  repeat: "repeat",
  who: "assignee",
  label: "label",
  list: "list",
  filler: "",
};

/**
 * A title part as New item uses it: `out` when it's taken out of the title,
 * `stays` when it sets its field and stays, `clash` when it disagrees with a
 * field already picked (which wins, so its words stay), and the value it
 * sets as the chip shows it.
 */
export type ShownPart = PlacedPart & {
  shown: "out" | "stays" | "clash";
  /** Kept in the title by the user. */
  kept: boolean;
  value: string;
};

/**
 * A checklist line as typed, read by the rules alone, without Jev: an
 * @handle of someone who can edit the list assigns them, a #word labels it,
 * and filler such as "Remind me to" goes. Both checklists, New item's and
 * the item's own, read their lines this way, so a line adds the same from
 * either. `reset` forgets what was kept in or dropped, for the next line.
 */
export function useLineParts(title: string, people: AssigneeView[], labels: string[]) {
  const [kept, setKept] = useState<string[]>([]);
  const [dropped, setDropped] = useState<string[]>([]);
  const key = (p: TitlePart) => `${p.field}:${p.text.toLowerCase()}`;
  const found = ruleParts(title, {
    people: people.map((a) => ({ userId: a.userId, handle: a.displayUsername ?? a.username })),
    labels,
  }).filter((p) => !dropped.includes(key(p)));
  const parts: ShownPart[] = placeParts(title, found).map((p) => {
    const person = p.field === "who" ? people.find((a) => a.userId === p.userId) : undefined;
    const isKept = kept.includes(key(p));
    return {
      ...p,
      kept: isKept,
      value: person ? assigneeName(person) : p.field === "label" ? p.label : "",
      shown: p.remove && !isKept ? "out" : "stays",
    };
  });
  const { saved, struck } = cutTitle(title, parts.filter((p) => p.shown === "out"));
  return {
    parts,
    saved,
    struck,
    assigneeIds: [...new Set(parts.flatMap((p) => (p.field === "who" ? [p.userId] : [])))],
    labels: [...new Set(parts.flatMap((p) => (p.field === "label" ? [p.label] : [])))],
    onKeep: (p: ShownPart) =>
      setKept((cur) => (cur.includes(key(p)) ? cur.filter((k) => k !== key(p)) : [...cur, key(p)])),
    onDrop: (p: ShownPart) => setDropped((cur) => [...cur, key(p)]),
    reset: () => {
      setKept([]);
      setDropped([]);
    },
  };
}

// The text of each kind of field: a title, large and unboxed; a checklist
// line, boxed as an Input is. The overlay copy and the input share it, so
// the copy sits exactly under the typing. 16px on phones, so iOS doesn't
// zoom in on focus.
const TEXT = {
  title: "text-base leading-6 font-medium",
  line: "text-base leading-6 md:text-sm",
};

/**
 * New item's title, or a checklist line (`variant="line"`): an input over a
 * copy of its text that highlights the parts setting a field and strikes
 * the words the item adds without. The input's own text is transparent, so
 * typing, the caret, selection and undo are the browser's own. Under it,
 * the title it adds as; with the caret in a part, what it sets and the
 * choices to keep it in the title or not set it.
 */
export function TitleField({
  inputRef,
  title,
  onTitle,
  parts,
  saved,
  struck,
  onKeep,
  onDrop,
  disabled,
  variant = "title",
  placeholder = "Add a task…",
  label = "Title",
  onKeyDown,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  title: string;
  onTitle: (title: string) => void;
  parts: ShownPart[];
  /** The title it adds as. */
  saved: string;
  /** The spans of `title` it adds without, to strike. */
  struck: Array<[number, number]>;
  /** Keeps a part's words in the title (or takes them out again). */
  onKeep: (part: ShownPart) => void;
  /** Stops a part setting its field; its words stay. */
  onDrop: (part: ShownPart) => void;
  disabled: boolean;
  variant?: "title" | "line";
  placeholder?: string;
  /** Its accessible name. Not a task's title: Safari reads it to guess the
   * field, and offered phone-number AutoFill for "Change phone plan". */
  label?: string;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}) {
  const text = TEXT[variant];
  const [scroll, setScroll] = useState(0);
  const [caret, setCaret] = useState<number | null>(null);
  const panelId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const at = caret == null ? undefined : parts.find((p) => caret >= p.start && caret <= p.end);
  // What each part sets, said while the caret's elsewhere, so the struck
  // words don't leave you guessing once you've moved on.
  const setting = parts.filter((p) => p.shown !== "clash" && p.field !== "filler");
  const track = (e: React.SyntheticEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    setCaret(document.activeElement === input ? input.selectionStart : null);
    setScroll(input.scrollLeft);
  };

  // The copy, cut where a part or a struck word starts or ends.
  const cuts = [
    ...new Set([0, title.length, ...parts.flatMap((p) => [p.start, p.end]), ...struck.flat()]),
  ].sort((a, b) => a - b);
  const runs = cuts.slice(0, -1).map((s, i) => {
    const e = cuts[i + 1];
    const part = parts.find((p) => p.start <= s && e <= p.end && p.field !== "filler");
    const out = struck.some(([a, b]) => a <= s && e <= b);
    const tone = part && part.shown !== "clash" && !part.kept ? PART_TONE[part.field] : null;
    return (
      <span
        key={s}
        className={cn(
          part?.shown === "clash" && "underline decoration-amber-500 decoration-wavy underline-offset-4",
          tone?.text,
        )}
      >
        {out ? (
          // Struck as a done item is (Struck), its gap the colour behind it.
          <Struck className={tone?.gap || "[--strike-gap:var(--color-popover)]"}>
            {title.slice(s, e)}
          </Struck>
        ) : (
          title.slice(s, e)
        )}
      </span>
    );
  });

  return (
    <>
      <div
        className={cn(
          // Laid out as the checklist's rows are, as the line it's about to
          // be, with a faint tint while it's being typed in.
          variant === "line" &&
            "flex scroll-mb-4 items-center gap-2 rounded-md px-1 py-0.5 transition-colors focus-within:bg-neutral-100/70 touch:py-1.5 dark:focus-within:bg-neutral-800/50",
        )}
      >
      {/* The circle the line will have, fainter: a stand-in, not a control. */}
      {variant === "line" && (
        <span
          aria-hidden
          className="size-4 shrink-0 rounded-full border-[1.5px] border-neutral-200 dark:border-neutral-700"
        />
      )}
      <div className={cn("relative", variant === "line" && "min-w-0 flex-1")}>
        <div
          aria-hidden
          className={cn("pointer-events-none absolute inset-0 overflow-hidden whitespace-pre", text)}
        >
          <div style={{ transform: `translateX(${-scroll}px)` }}>{runs}</div>
        </div>
        <input
          ref={inputRef}
          value={title}
          onChange={(e) => {
            onTitle(e.target.value);
            track(e);
          }}
          onSelect={track}
          onScroll={track}
          onKeyDown={onKeyDown}
          // Tabbing on to the part's choices keeps them; anywhere else drops them.
          onBlur={(e) => {
            if (!panelRef.current?.contains(e.relatedTarget)) setCaret(null);
          }}
          aria-describedby={panelId}
          // Coming back to New item from an item it opened lands here too.
          autoFocus={variant === "title"}
          placeholder={placeholder}
          aria-label={label}
          className={cn(
            "relative w-full bg-transparent text-transparent caret-foreground outline-none placeholder:text-muted-foreground selection:bg-blue-500/30 selection:text-transparent",
            text,
          )}
        />
      </div>
      </div>
      {/* One panel: what it adds as, then, while the caret's in a part, that
          part. Always there, as the title's description, so screen readers
          hear it change. */}
      <div
        id={panelId}
        ref={panelRef}
        aria-live="polite"
        onBlur={(e) => {
          if (e.relatedTarget !== inputRef.current && !e.currentTarget.contains(e.relatedTarget)) {
            setCaret(null);
          }
        }}
      >
      {(saved !== title.trim() || setting.length > 0 || at) && (
        <div className="grid gap-1 rounded-lg bg-muted px-2.5 py-1.5 text-xs text-muted-foreground">
          {saved !== title.trim() && (
            <p className="min-w-0">
              Adds as <span className="font-medium text-foreground">“{saved}”</span>
            </p>
          )}
          {/* Not announced: it's rebuilt at each answer while typing. */}
          {!at && setting.length > 0 && (
            <p
              aria-live="off"
              className="flex min-w-0 items-center gap-2 border-t border-border pt-1 first:border-t-0 first:pt-0">
              <span className={cn("size-1.5 shrink-0 rounded-full", PART_TONE[setting[0].field].dot)} />
              <span className="min-w-0">
                {setting
                  .map(
                    (p) =>
                      `“${p.text}” sets the ${FIELD_NAME[p.field]}: ${p.value}` +
                      (p.shown === "stays" ? " (stays in the title)" : ""),
                  )
                  .join(", ")}
              </span>
            </p>
          )}
          {/* Pressing a choice mustn't move the caret out of the part. */}
          {at && (
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 border-t border-border pt-1 first:border-t-0 first:pt-0">
              <span className={cn("size-1.5 shrink-0 rounded-full", PART_TONE[at.field].dot)} />
              <span className="min-w-0 flex-1 truncate">
                “{at.text}”{" "}
                {at.field === "filler"
                  ? "adds nothing to a task"
                  : at.shown === "clash"
                    ? `says ${at.value}, but the ${FIELD_NAME[at.field]} you picked stands`
                    : `sets the ${FIELD_NAME[at.field]}: ${at.value}`}
              </span>
              {at.shown !== "clash" && at.remove && (
                <PartButton disabled={disabled} onClick={() => onKeep(at)}>
                  {at.kept ? "Take out of title" : "Keep in title"}
                </PartButton>
              )}
              {at.shown !== "clash" && at.field !== "filler" && (
                <PartButton disabled={disabled} onClick={() => onDrop(at)}>
                  Don’t set
                </PartButton>
              )}
            </div>
          )}
        </div>
      )}
      </div>
    </>
  );
}

/** A small button in a panel under New item's title. */
export function PartButton({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      // Keeps the caret in the title, so the choice applies to this part.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-6 shrink-0 items-center gap-1 rounded-md bg-background px-2 font-medium text-foreground ring-1 ring-border hover:bg-muted disabled:opacity-50 touch:h-8"
    >
      {children}
    </button>
  );
}
