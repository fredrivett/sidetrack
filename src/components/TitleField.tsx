"use client";

import { useId, useRef, useState } from "react";
import type { PlacedPart, TitleField as Field } from "@/lib/titleParts";
import { cn } from "@/lib/utils";
import { Struck } from "./Struck";

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
 * New item's title: an input over a copy of its text that highlights the
 * parts setting a field and strikes the words the item adds without. The
 * input's own text is transparent, so typing, the caret, selection and undo
 * are the browser's own. Under it, the title it adds as; with the caret in
 * a part, what it sets and the choices to keep it in the title or not set it.
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
}) {
  const [scroll, setScroll] = useState(0);
  const [caret, setCaret] = useState<number | null>(null);
  const panelId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const at = caret == null ? undefined : parts.find((p) => caret >= p.start && caret <= p.end);
  const staying = parts.filter((p) => p.shown === "stays" && p.field !== "filler" && !p.kept);
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
      <div className="relative">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 overflow-hidden text-base leading-6 font-medium whitespace-pre"
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
          // Tabbing on to the part's choices keeps them; anywhere else drops them.
          onBlur={(e) => {
            if (!panelRef.current?.contains(e.relatedTarget)) setCaret(null);
          }}
          aria-describedby={panelId}
          // Coming back to New item from an item it opened lands here too.
          autoFocus
          placeholder="Add a task…"
          aria-label="Title"
          className="relative w-full bg-transparent text-base leading-6 font-medium text-transparent caret-foreground outline-none placeholder:text-muted-foreground selection:bg-blue-500/30 selection:text-transparent"
        />
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
      {(saved !== title.trim() || staying.length > 0 || at) && (
        <div className="grid gap-1 rounded-lg bg-muted px-2.5 py-1.5 text-xs text-muted-foreground">
          {saved !== title.trim() ? (
            <p className="min-w-0">
              Adds as <span className="font-medium text-foreground">“{saved}”</span>
            </p>
          ) : (
            staying.length > 0 && (
              <p className="flex min-w-0 items-center gap-2">
                <span className={cn("size-1.5 shrink-0 rounded-full", PART_TONE[staying[0].field].dot)} />
                <span className="min-w-0">
                  {staying.map((p) => `“${p.text}” sets the ${FIELD_NAME[p.field]}`).join(", ")}, and
                  stays in the title
                </span>
              </p>
            )
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
