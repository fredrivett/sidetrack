"use client";

import { type Ref, useId, useLayoutEffect, useRef, useState } from "react";
import type { AssigneeView } from "@/core/members";
import { mentionQueryAt, suggestPeople } from "@/lib/mentions";
import { assigneeName, UserAvatar } from "./UserAvatar";

/**
 * A textarea where typing `@` suggests people to mention, as Linear and
 * Slack do: ↑↓ or the mouse to choose, Enter or Tab to put in their
 * `@username`, Esc to carry on typing without one. While the list is open it
 * has those keys; otherwise they reach `onKeyDown`. Writing a new comment and
 * editing one both use it.
 */
export function MentionTextarea({
  people,
  value,
  onValueChange,
  maxLength,
  ref,
  onKeyDown,
  onBlur,
  ...props
}: Omit<React.ComponentProps<"textarea">, "value" | "onChange"> & {
  /** Who can be mentioned, in the order to suggest them. None makes it a
   * plain textarea. */
  people: AssigneeView[];
  value: string;
  onValueChange: (next: string) => void;
  ref?: Ref<HTMLTextAreaElement>;
}) {
  const box = useRef<HTMLTextAreaElement | null>(null);
  // The `@…` before the caret, and which suggestion is highlighted.
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [active, setActive] = useState(0);
  // The `@` Esc dismissed, so its suggestions stay away while you type on.
  const [dismissed, setDismissed] = useState<number | null>(null);
  // Where the caret goes once a picked mention is in the text.
  const caretAfter = useRef<number | null>(null);
  const listId = useId();
  const disabled = Boolean(props["aria-disabled"]);
  // The text as this box last left it. When the owner sets another, such as
  // clearing it after a send, the `@…` being typed is gone with it.
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    setMention(null);
    setDismissed(null);
  }

  // None while it saves, so its keys go back to the box.
  const suggestions =
    mention && mention.start !== dismissed && !disabled
      ? suggestPeople(people, mention.query)
      : [];
  const open = suggestions.length > 0;
  const highlighted = Math.min(active, suggestions.length - 1);

  useLayoutEffect(() => {
    if (caretAfter.current === null || !box.current) return;
    box.current.setSelectionRange(caretAfter.current, caretAfter.current);
    caretAfter.current = null;
  }, [value]);

  // Follows the caret, which typing, clicking and the arrow keys all move.
  function track(el: HTMLTextAreaElement) {
    const next = mentionQueryAt(el.value, el.selectionStart);
    if (next?.start !== mention?.start) setActive(0);
    if (!next) setDismissed(null);
    setMention(next);
  }

  /** Puts in the person's `@username` for the whole handle the caret is in,
   * so picking with the caret mid-handle leaves no tail behind. False when
   * there's no room for it. */
  function pick(person: AssigneeView): boolean {
    const el = box.current;
    if (disabled || !mention || !el) return false;
    let end = el.selectionStart;
    while (end < value.length && /[a-zA-Z0-9_.]/.test(value[end])) end++;
    const rest = value.slice(end);
    // One space after it, reusing one that's already there.
    const spaced = /^\s/.test(rest);
    const text = `@${person.displayUsername ?? person.username}${spaced ? "" : " "}`;
    const next = value.slice(0, mention.start) + text + rest;
    // Like typing past maxLength: no room, no change. Counted as the server
    // counts, in characters.
    if (maxLength !== undefined && [...next].length > maxLength) return false;
    const caret = mention.start + text.length + (spaced ? 1 : 0);
    // The same text (the whole name was there) won't re-render to move the
    // caret, so move it now.
    if (next === value) el.setSelectionRange(caret, caret);
    else {
      caretAfter.current = caret;
      setSeen(next);
      onValueChange(next);
    }
    setMention(null);
    return true;
  }

  return (
    <div className="relative">
      {/* Plain, not the ui Textarea: each box keeps its own look. */}
      <textarea
        {...props}
        ref={(el) => {
          box.current = el;
          if (typeof ref === "function") ref(el);
          else if (ref) ref.current = el;
        }}
        value={value}
        maxLength={maxLength}
        onChange={(e) => {
          if (disabled) return;
          setSeen(e.target.value);
          onValueChange(e.target.value);
          track(e.target);
        }}
        onSelect={(e) => track(e.currentTarget)}
        onBlur={(e) => {
          setMention(null);
          onBlur?.(e);
        }}
        onKeyDown={(e) => {
          if (open && !e.nativeEvent.isComposing && !e.metaKey && !e.ctrlKey) {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              const step = e.key === "ArrowDown" ? 1 : -1;
              setActive((highlighted + step + suggestions.length) % suggestions.length);
              return;
            }
            // With no room for the name, the key does what it would anyway.
            if ((e.key === "Enter" || e.key === "Tab") && pick(suggestions[highlighted])) {
              e.preventDefault();
              return;
            }
            if (e.key === "Escape") {
              // Closes the suggestions, not the edit or the dialog.
              e.preventDefault();
              e.stopPropagation();
              setDismissed(mention?.start ?? null);
              return;
            }
          }
          onKeyDown?.(e);
        }}
        {...(people.length > 0 && {
          role: "combobox",
          "aria-autocomplete": "list",
          "aria-expanded": open,
          "aria-controls": open ? listId : undefined,
          "aria-activedescendant": open ? `${listId}-${highlighted}` : undefined,
        })}
      />
      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label="People to mention"
          // Above the box, as in Slack: comments sit at the foot of the
          // dialog, whose scrolling would cut off a list below.
          className="absolute right-0 bottom-full left-0 z-50 mb-1 rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10"
        >
          {suggestions.map((p, i) => (
            <li
              key={p.userId}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === highlighted}
              // Keeps focus (and the caret) in the box.
              onMouseDown={(e) => e.preventDefault()}
              onMouseMove={() => setActive(i)}
              onClick={() => pick(p)}
              className="flex cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1 text-sm select-none aria-selected:bg-accent aria-selected:text-accent-foreground"
            >
              <UserAvatar user={p} size={18} />
              <span className="truncate">{p.name ?? assigneeName(p)}</span>
              {p.name && (
                <span className="shrink-0 text-muted-foreground">
                  @{p.displayUsername ?? p.username}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
