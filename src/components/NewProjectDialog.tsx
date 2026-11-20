"use client";

import { useRef, useState, useTransition } from "react";
import { Boxes, Globe, Plus } from "lucide-react";
import { createProjectAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ResponsiveDialog,
  ResponsiveDialogCloseButton,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import type { SpaceView } from "@/core/spaces";
import { dedupePrefix, derivePrefix } from "@/lib/itemRef";
import { normalizeHomepageUrl } from "@/lib/url";
import { CHIP, EMPTY_CHIP, TextChip } from "./DialogFields";
import { IconPicker } from "./ProjectIconPicker";
import { runAction } from "./run-action";
import { type EmojiChoice, UNCHOSEN, useTitleEmoji } from "./use-emoji-choice";
import { aiRead } from "./ai-read";

// The homepage as it would be saved, or null while blank or not yet valid.
function homepagePreview(raw: string): string | null {
  try {
    return normalizeHomepageUrl(raw);
  } catch {
    return null;
  }
}

export function NewProjectDialog({
  open,
  onOpenChange,
  takenPrefixes,
  spaces,
  defaultSpaceId = "",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The viewer's own lists' prefixes, to preview the new list's item IDs. */
  takenPrefixes: string[];
  /** Spaces to create the list in: those the viewer is an admin or member
   * of. */
  spaces: SpaceView[];
  /** The Space to create the list in by default: the tray whose + opened it. */
  defaultSpaceId?: string;
}) {
  const [name, setName] = useState("");
  const [summary, setSummary] = useState("");
  const [homepage, setHomepage] = useState("");
  // "" for no Space.
  const [spaceId, setSpaceId] = useState("");
  // The icon the user chose in the picker, if any (null for none).
  const [picked, setPicked] = useState<EmojiChoice>(UNCHOSEN);
  const [pending, start] = useTransition();
  const nameRef = useRef<HTMLInputElement>(null);

  // Clear the form each time the dialog opens (React's render-time reset
  // pattern, avoiding a reset-in-effect).
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setName("");
      setSummary("");
      setHomepage("");
      setSpaceId(defaultSpaceId);
      setPicked(UNCHOSEN);
    }
  }

  const trimmedName = name.trim();
  const homepageUrl = homepagePreview(homepage);
  // Until the user picks, a homepage shows its favicon; otherwise the top AI
  // suggestion stands in, so the list is created with what the preview shows.
  const { shown: icon, suggestions, onOpen } = useTitleEmoji({
    saved: picked,
    title: open ? trimmedName : "",
    savedTitle: null,
    context: [summary, homepageUrl],
    suggest: (next, signal) => aiRead("listIcons", { name: next, summary, homepageUrl }, signal),
    none: Boolean(homepageUrl),
  });
  const space = spaces.find((s) => s.id === spaceId);
  const prefix = dedupePrefix(derivePrefix(trimmedName), new Set(takenPrefixes));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    // The Homepage chip only takes a valid URL, so there's nothing else to check.
    if (!trimmedName) return;
    start(async () => {
      const created = await runAction(
        createProjectAction({
          name: trimmedName,
          summary,
          homepageUrl,
          icon: icon.emoji,
          iconChosen: icon.chosen,
          spaceId: spaceId || null,
        }),
        "create the list",
      );
      if (created) onOpenChange(false);
    });
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent initialFocus={nameRef}>
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain px-4 pt-3 pb-4">
            <div className="flex min-w-0 items-center gap-1">
              <ResponsiveDialogTitle className="text-sm font-medium text-neutral-500">
                New list
              </ResponsiveDialogTitle>
              <ResponsiveDialogDescription className="sr-only">
                Create a new list.
              </ResponsiveDialogDescription>
              <ResponsiveDialogCloseButton className="ml-auto" />
            </div>
            <div className="flex items-center gap-2">
              <IconPicker
                icon={icon.emoji}
                chosen={icon.chosen}
                homepageUrl={homepageUrl}
                name={trimmedName}
                size={22}
                disabled={pending}
                faded={icon.faded}
                suggestions={suggestions}
                onOpen={onOpen}
                onSelect={(emoji) => setPicked({ emoji, chosen: true })}
              />
              <input
                ref={nameRef}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="List name, e.g. Home or Buy"
                aria-label="Name"
                disabled={pending}
                className="min-w-0 flex-1 bg-transparent text-base leading-6 font-medium outline-none placeholder:text-muted-foreground disabled:opacity-50"
              />
            </div>
            <textarea
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="Add summary…"
              aria-label="Summary"
              disabled={pending}
              rows={1}
              className="field-sizing-content max-h-48 w-full resize-none bg-transparent text-sm text-neutral-600 outline-none placeholder:text-muted-foreground disabled:opacity-50 dark:text-neutral-300"
            />
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              {spaces.length > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    aria-disabled={pending || undefined}
                    title="Space"
                    className={space ? CHIP : EMPTY_CHIP}
                  >
                    {space?.icon && !space.icon.startsWith("http") ? (
                      <span className="text-sm leading-none">{space.icon}</span>
                    ) : (
                      <Boxes />
                    )}
                    <span data-replay-safe className="max-w-48 truncate">
                      {space ? space.name : "Just me"}
                    </span>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-56">
                    <DropdownMenuRadioGroup
                      value={spaceId}
                      onValueChange={(next: string) => setSpaceId(next)}
                    >
                      <DropdownMenuRadioItem value="" closeOnClick>None, just me</DropdownMenuRadioItem>
                      <DropdownMenuSeparator />
                      {spaces.map((s) => (
                        <DropdownMenuRadioItem key={s.id} value={s.id} closeOnClick>
                          {s.icon && !s.icon.startsWith("http") && <span>{s.icon}</span>}
                          {s.name}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              <TextChip
                icon={<Globe />}
                label="Homepage"
                value={homepage}
                placeholder="example.com"
                validate={(next) =>
                  homepagePreview(next) ? null : "That doesn't look like a valid URL."
                }
                onSave={setHomepage}
                disabled={pending}
              >
                <span className="max-w-48 truncate">
                  {homepageUrl?.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}
                </span>
              </TextChip>
            </div>
            {(trimmedName || space) && (
              <p className="text-xs text-muted-foreground">
                {trimmedName && `Items will be numbered ${prefix}-1, ${prefix}-2, …`}
                {trimmedName && space && " "}
                {space && `Everyone in ${space.name} can see and edit it.`}
              </p>
            )}
          </div>

          <div className="flex shrink-0 justify-end gap-2 border-t border-neutral-200 px-4 py-3 dark:border-neutral-800">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={!trimmedName || pending}>
              <Plus data-icon="inline-start" />
              Create
            </Button>
          </div>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
