"use client";

import { Check, SmilePlus, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { updateProjectAction } from "@/app/actions";
import type { Project } from "@/core/schema";
import { normalizeWebUrl } from "@/lib/url";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  EmojiPicker,
  EmojiPickerContent,
  EmojiPickerSearch,
  EmojiPickerSkinTones,
  EmojiPickerToned,
} from "@/components/ui/emoji-picker";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ProjectIcon } from "./ProjectIcon";
import { useListAccess } from "./list-access";
import { runAction } from "./run-action";
import { useTitleEmoji } from "./use-emoji-choice";
import { useListSave } from "./use-list-saves";
import { aiRead } from "./ai-read";

/** A saved list's icon (see useTitleEmoji): `rename` keeps it in step. */
export function useListIcon(project: Project) {
  const { name, summary, homepageUrl } = project;
  const icon = useTitleEmoji({
    saved: { emoji: project.icon, chosen: project.iconChosen },
    title: name,
    savedTitle: name,
    context: [summary, homepageUrl],
    suggest: (next, signal) =>
      aiRead("listIcons", { id: project.id, name: next, summary, homepageUrl }, signal),
    none: Boolean(homepageUrl),
  });
  return {
    ...icon,
    /** The patch that renames the list to `next`, keeping the icon shown. */
    rename(next: string) {
      const auto = icon.toSave();
      return auto ? { name: next, icon: auto.emoji, iconChosen: false } : { name: next };
    },
  };
}

/**
 * A list's icon, saved as someone's choice as soon as one is picked. Pass
 * `fadeUnchosen` where the list is being edited, so one nobody chose shows
 * faded there; elsewhere, such as the board, it shows like any other.
 */
export function ProjectIconPicker({
  project,
  listIcon,
  size = 20,
  fadeUnchosen = false,
}: {
  project: Project;
  listIcon: ReturnType<typeof useListIcon>;
  size?: number;
  fadeUnchosen?: boolean;
}) {
  // Held on the list: its column dims until the new icon lands.
  const { saving, save } = useListSave();
  // Someone who can't change the list sees its icon, with no picker.
  if (useListAccess(project.id) !== "edit") {
    return (
      <span className="inline-flex shrink-0 p-1 -ml-1">
        <ProjectIcon
          icon={listIcon.shown.emoji}
          homepageUrl={project.homepageUrl}
          name={project.name}
          size={size}
        />
      </span>
    );
  }
  return (
    <IconPicker
      icon={listIcon.shown.emoji}
      chosen={listIcon.shown.chosen}
      faded={fadeUnchosen && listIcon.shown.faded}
      homepageUrl={project.homepageUrl}
      name={project.name}
      size={size}
      disabled={saving}
      // -ml-1 cancels the p-1 hover padding so the icon itself lines up with
      // the content below the header, not 4px in from it.
      className="-ml-1"
      suggestions={listIcon.suggestions}
      onOpen={listIcon.onOpen}
      onSelect={(next) =>
        save(() => runAction(updateProjectAction(project.id, { icon: next }), "update the icon"))
      }
    />
  );
}

// Two rows of the grid's 9 columns, so however many Jev rates a fit, the grid and the
// skin tone footer keep their room in the fixed-height picker.
const MAX_SUGGESTIONS = 18;

/**
 * The icon picker itself, controlled: `icon` is what shows (an emoji or
 * image URL; null shows the homepage favicon, else the letter), and
 * `onSelect` reports someone's choice, null meaning "no icon". Used for saved
 * lists, the New list dialog, which holds the choice until the list is
 * created, Spaces, and, `emojiOnly`, for labels.
 */
export function IconPicker({
  icon,
  chosen,
  homepageUrl = null,
  name = "",
  size,
  disabled,
  className,
  faded,
  emojiOnly,
  label = "list icon",
  suggestions,
  onOpen,
  onSelect,
}: {
  icon: string | null;
  /** Someone chose `icon` (or none), so None isn't offered again for none. */
  chosen: boolean;
  homepageUrl?: string | null;
  /** The list's name, for the letter shown without an icon. */
  name?: string;
  size: number;
  /** Dimmed and won't open; stays focusable (aria-disabled), so a save that
   * lands after picking doesn't drop keyboard focus. */
  disabled?: boolean;
  className?: string;
  /** Show the icon at half opacity, e.g. an AI suggestion not yet picked. */
  faded?: boolean;
  /** Emoji only, no favicon or image URL; without one, a smiley-plus shows. */
  emojiOnly?: boolean;
  /** What the icon is, for the button's name, e.g. "list icon". */
  label?: string;
  suggestions: string[];
  onOpen?: () => void;
  onSelect: (icon: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [imageUrl, setImageUrl] = useState("");
  const [query, setQuery] = useState("");
  // No icon + a homepage means the favicon is what's showing — so the favicon
  // row reads as the active selection.
  const faviconActive = !icon && Boolean(homepageUrl);

  function select(next: string | null) {
    setOpen(false);
    onSelect(next);
  }

  function submitImageUrl() {
    const raw = imageUrl.trim();
    if (!raw) return;
    // Validate (and normalize) client-side so the message is accurate and we
    // send the core a clean URL — the core would accept it either way.
    let normalized: string | null;
    try {
      normalized = normalizeWebUrl(raw, "image URL");
    } catch {
      toast.error("That doesn't look like a valid image URL.");
      return;
    }
    if (!normalized) return;
    setImageUrl("");
    select(normalized);
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next, details) => {
        if (next && disabled) return details.cancel();
        setOpen(next);
        if (next) {
          setQuery("");
          onOpen?.();
        }
      }}
    >
      <PopoverTrigger
        aria-label={`Change ${label}`}
        aria-disabled={disabled || undefined}
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-md p-1 transition-colors hover:bg-muted aria-expanded:bg-muted aria-disabled:opacity-60",
          className,
        )}
      >
        {emojiOnly ? (
          icon ? (
            <span
              aria-hidden
              className={cn("leading-none", faded && "opacity-50")}
              style={{ fontSize: Math.round(size * 0.85) }}
            >
              {icon}
            </span>
          ) : (
            <SmilePlus
              aria-hidden
              className="text-muted-foreground"
              style={{ width: size, height: size }}
            />
          )
        ) : (
          <ProjectIcon
            icon={icon}
            homepageUrl={homepageUrl}
            name={name}
            size={size}
            className={cn(faded && "opacity-50")}
          />
        )}
      </PopoverTrigger>
      <PopoverContent
        // The emoji grid is what's picked from. Its search, the first
        // field, still gets focus with a mouse; on a phone a keyboard would
        // cover the grid.
        initialFocus={null}
        align="start"
        className="w-[288px] p-0"
      >
        <EmojiPicker
          className="h-[340px] w-full"
          onEmojiSelect={({ emoji }) => select(emoji)}
        >
          <div className="flex items-center gap-1 border-b px-2 py-1.5">
            <EmojiPickerSearch
              placeholder="Search emoji…"
              className="h-7 border-0 px-1"
              onChange={(e) => setQuery(e.target.value)}
            />
            {/* Also offered with nothing showing yet, so "none" can be
                chosen before a suggestion fills in. */}
            {(icon || !chosen) && (
              <button
                type="button"
                onClick={() => select(null)}
                className="inline-flex h-7 shrink-0 items-center gap-1 rounded px-2 text-xs text-muted-foreground hover:text-foreground"
              >
                <X className="size-3" />
                {icon ? "Remove" : "None"}
              </button>
            )}
          </div>
          {/* Styled as the grid's first category; it sits above the grid
              rather than in it because frimousse virtualizes the grid's
              rows. Searching hides it, like any category without a match. */}
          {suggestions.length > 0 && !query.trim() && (
            <div className="shrink-0">
              <div className="px-3 pt-3.5 pb-2 text-xs leading-none text-muted-foreground">
                Suggested
              </div>
              {/* As wide as the grid's 9 columns, so they line up. */}
              <div className="flex max-w-[16.25rem] flex-wrap px-1">
                {suggestions.slice(0, MAX_SUGGESTIONS).map((emoji) => (
                  <EmojiPickerToned key={emoji} emoji={emoji}>
                    {(toned) => (
                      <button
                        type="button"
                        aria-label={`Use ${toned}`}
                        onClick={() => select(toned)}
                        className={cn(
                          "flex size-7 items-center justify-center rounded-sm text-base hover:bg-accent",
                          icon === toned && "bg-accent",
                        )}
                      >
                        {toned}
                      </button>
                    )}
                  </EmojiPickerToned>
                ))}
              </div>
            </div>
          )}
          <EmojiPickerContent />
          {/* Retones the icon in place, keeping the picker open to compare
              tones. A faded suggestion is saved in the new tone as the
              choice, as picking a tone for it is choosing it. */}
          <EmojiPickerSkinTones
            emoji={icon}
            onEmojiChange={onSelect}
            disabled={disabled}
          />
        </EmojiPicker>

        {!emojiOnly && (
          <div className="space-y-2 border-t p-2">
            {homepageUrl && (
              <button
                type="button"
                onClick={() => select(null)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted",
                  faviconActive && "bg-muted",
                )}
              >
                <ProjectIcon
                  icon={null}
                  homepageUrl={homepageUrl}
                  name={name}
                  size={18}
                />
                <span className="flex-1 truncate">Use website favicon</span>
                {faviconActive && <Check className="size-3.5 shrink-0" />}
              </button>
            )}
            <div className="flex items-center gap-1">
              <Input
                type="text"
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
                // frimousse listens for keydown on `document` and treats Enter as
                // "pick the active emoji". Stop our keystrokes there so typing a
                // URL (and pressing Enter to submit it) can't also fire an emoji
                // selection — that race was the source of the bogus error toast.
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Enter") {
                    e.preventDefault();
                    submitImageUrl();
                  }
                }}
                placeholder="Or paste an image URL…"
                className="h-8 text-sm"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={submitImageUrl}
                disabled={!imageUrl.trim()}
              >
                Set
              </Button>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
