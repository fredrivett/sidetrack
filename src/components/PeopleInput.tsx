"use client";

import type { Ref } from "react";
import { X } from "lucide-react";
import { Input } from "@/components/ui/input";

/** The handles in what's typed, split on commas or spaces. */
export const handlesIn = (text: string) => text.split(/[\s,]+/).filter(Boolean);

/** Everyone being invited: those added, and what's typed but not added yet, so Invite doesn't drop it. */
export const everyoneIn = (people: string[], typed: string) => [...new Set([...people, ...handlesIn(typed)])];

/**
 * Who to invite, as Invite people, Share and Spaces take it: usernames or
 * emails, each added as a chip under the input on a comma or Enter, and
 * Backspace in an empty input taking off the last. What's typed counts
 * without being added (everyoneIn). Leaving the input doesn't add it: the
 * chip row appearing would move a dialog's buttons under the pointer, so
 * clicking Invite would miss.
 */
export function PeopleInput({
  people,
  onPeopleChange,
  typed,
  onTypedChange,
  disabled = false,
  inputRef,
  label = "Who to invite",
}: {
  people: string[];
  onPeopleChange: (next: string[]) => void;
  /** What's typed and not yet added, usually a draft. */
  typed: string;
  onTypedChange: (next: string) => void;
  /** While it saves: input is ignored, keeping focus. */
  disabled?: boolean;
  inputRef?: Ref<HTMLInputElement>;
  label?: string;
}) {
  function add(text: string) {
    const handles = handlesIn(text);
    if (handles.length === 0) return;
    onPeopleChange([...new Set([...people, ...handles])]);
    onTypedChange("");
  }

  return (
    <div>
      <Input
        ref={inputRef}
        value={typed}
        onChange={(e) => !disabled && onTypedChange(e.target.value)}
        onKeyDown={(e) => {
          if (disabled) return;
          if (e.key === "," || (e.key === "Enter" && typed.trim())) {
            e.preventDefault();
            add(typed);
          } else if (e.key === "Backspace" && !typed && people.length > 0) {
            onPeopleChange(people.slice(0, -1));
          }
        }}
        placeholder="Usernames or emails"
        aria-label={label}
        autoComplete="off"
        readOnly={disabled}
      />
      {people.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="People to invite">
          {people.map((p) => (
            <li
              key={p}
              className="flex items-center gap-1 rounded-full bg-neutral-100 py-0.5 pr-1 pl-2.5 text-xs dark:bg-neutral-800"
            >
              {p}
              <button
                type="button"
                aria-label={`Don't invite ${p}`}
                aria-disabled={disabled || undefined}
                onClick={() => !disabled && onPeopleChange(people.filter((x) => x !== p))}
                className="rounded-full p-0.5 text-neutral-500 hover:bg-neutral-200 hover:text-neutral-900 dark:hover:bg-neutral-700 dark:hover:text-neutral-100"
              >
                <X className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
