"use client";

import { Check, X } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { updateProjectAction } from "@/app/actions";
import type { Project } from "@/core/schema";
import { faviconUrl } from "@/lib/projectIcon";
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

export function ProjectIconPicker({
  project,
  size = 20,
}: {
  project: Project;
  size?: number;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [imageUrl, setImageUrl] = useState("");
  const favicon = project.homepageUrl ? faviconUrl(project.homepageUrl) : null;
  // No explicit icon + a homepage means the favicon is what's showing — so the
  // favicon row reads as the active selection.
  const faviconActive = !project.icon && Boolean(favicon);

  function save(next: string | null, errorMsg: string) {
    setOpen(false);
    start(() => {
      void updateProjectAction(project.id, { icon: next }).catch(() =>
        toast.error(errorMsg),
      );
    });
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
    save(normalized, "Couldn't update the icon. Please try again.");
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label="Change project icon"
        disabled={pending}
        className="inline-flex shrink-0 items-center justify-center rounded-md p-1 transition-colors hover:bg-muted aria-expanded:bg-muted disabled:opacity-60"
      >
        <ProjectIcon
          icon={project.icon}
          homepageUrl={project.homepageUrl}
          name={project.name}
          size={size}
        />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[288px] p-0">
        <EmojiPicker
          className="h-[268px] w-full"
          onEmojiSelect={({ emoji }) =>
            save(emoji, "Couldn't set the icon. Please try again.")
          }
        >
          <div className="flex items-center gap-1 border-b px-2 py-1.5">
            <EmojiPickerSearch
              placeholder="Search emoji…"
              className="h-7 border-0 px-1"
            />
            {project.icon && (
              <button
                type="button"
                onClick={() => save(null, "Couldn't clear the icon.")}
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
          {favicon && (
            <button
              type="button"
              onClick={() => save(null, "Couldn't use the favicon.")}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted",
                faviconActive && "bg-muted",
              )}
            >
              <ProjectIcon
                icon={null}
                homepageUrl={project.homepageUrl}
                name={project.name}
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
