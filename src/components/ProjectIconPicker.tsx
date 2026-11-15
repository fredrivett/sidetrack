"use client";

import { Check, Sparkles, X } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { suggestProjectIconsAction, updateProjectAction } from "@/app/actions";
import type { Project } from "@/core/schema";
import { normalizeWebUrl } from "@/lib/url";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  EmojiPicker,
  EmojiPickerContent,
  EmojiPickerSearch,
} from "@/components/ui/emoji-picker";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ProjectIcon } from "./ProjectIcon";

/**
 * A list's icon, saved as soon as one is picked. AI suggestions load the
 * first time the picker opens.
 */
export function ProjectIconPicker({
  project,
  size = 20,
}: {
  project: Project;
  size?: number;
}) {
  const [pending, start] = useTransition();
  // Suggestions with the list details they were made for, refetched on open
  // once the name, summary or homepage changes. Empty when AI is off (no
  // TYPESAFE_API_KEY) or the request failed, so the suggestion row stays hidden.
  const [suggested, setSuggested] = useState<{
    for: string;
    emoji: string[];
  } | null>(null);
  const context = JSON.stringify([
    project.name,
    project.summary,
    project.homepageUrl,
  ]);

  return (
    <IconPicker
      icon={project.icon}
      homepageUrl={project.homepageUrl}
      name={project.name}
      size={size}
      disabled={pending}
      // -ml-1 cancels the p-1 hover padding so the icon itself lines up with
      // the content below the header, not 4px in from it.
      className="-ml-1"
      suggestions={suggested?.for === context ? suggested.emoji : []}
      onOpen={() => {
        if (suggested?.for === context) return;
        setSuggested({ for: context, emoji: [] });
        void suggestProjectIconsAction(project.id)
          .then((emoji) => setSuggested({ for: context, emoji }))
          .catch(() => {});
      }}
      onSelect={(next) =>
        start(() => {
          void updateProjectAction(project.id, { icon: next }).catch(() =>
            toast.error("Couldn't update the icon. Please try again."),
          );
        })
      }
    />
  );
}

/**
 * The icon picker itself, controlled: `icon` is what's chosen (an emoji or
 * image URL; null shows the homepage favicon, else the letter), and `onSelect`
 * reports a new choice, null meaning "no icon". Used for saved lists and for
 * the New list dialog, which holds the choice until the list is created.
 */
export function IconPicker({
  icon,
  homepageUrl,
  name,
  size,
  disabled,
  className,
  faded,
  suggestions,
  onOpen,
  onSelect,
}: {
  icon: string | null;
  homepageUrl: string | null;
  name: string;
  size: number;
  disabled?: boolean;
  className?: string;
  /** Show the icon at half opacity, e.g. an AI suggestion not yet picked. */
  faded?: boolean;
  suggestions: string[];
  onOpen?: () => void;
  onSelect: (icon: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [imageUrl, setImageUrl] = useState("");
  // No explicit icon + a homepage means the favicon is what's showing — so the
  // favicon row reads as the active selection.
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
      onOpenChange={(next) => {
        setOpen(next);
        if (next) onOpen?.();
      }}
    >
      <PopoverTrigger
        aria-label="Change list icon"
        disabled={disabled}
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-md p-1 transition-colors hover:bg-muted aria-expanded:bg-muted disabled:opacity-60",
          className,
        )}
      >
        <ProjectIcon
          icon={icon}
          homepageUrl={homepageUrl}
          name={name}
          size={size}
          className={cn(faded && "opacity-50")}
        />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[288px] p-0">
        {suggestions.length > 0 && (
          <div className="flex items-center gap-1 border-b px-2 py-1.5">
            <Sparkles
              aria-hidden
              className="size-3.5 shrink-0 text-muted-foreground"
            />
            <span className="mr-1 text-xs text-muted-foreground">
              Suggested
            </span>
            {suggestions.map((emoji) => (
              <button
                key={emoji}
                type="button"
                aria-label={`Use ${emoji} as the icon`}
                onClick={() => select(emoji)}
                className={cn(
                  "inline-flex size-8 items-center justify-center rounded-md text-lg hover:bg-muted",
                  icon === emoji && "bg-muted",
                )}
              >
                {emoji}
              </button>
            ))}
          </div>
        )}
        <EmojiPicker
          className="h-[268px] w-full"
          onEmojiSelect={({ emoji }) => select(emoji)}
        >
          <div className="flex items-center gap-1 border-b px-2 py-1.5">
            <EmojiPickerSearch
              placeholder="Search emoji…"
              className="h-7 border-0 px-1"
            />
            {icon && (
              <button
                type="button"
                onClick={() => select(null)}
                className="inline-flex h-7 shrink-0 items-center gap-1 rounded px-2 text-xs text-muted-foreground hover:text-foreground"
              >
                <X className="size-3" />
                Remove
              </button>
            )}
          </div>
          <EmojiPickerContent />
        </EmojiPicker>

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
      </PopoverContent>
    </Popover>
  );
}
