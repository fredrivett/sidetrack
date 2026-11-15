"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { createProjectAction, suggestNewListIconsAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ResponsiveDialog,
  ResponsiveDialogCloseButton,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { Textarea } from "@/components/ui/textarea";
import { dedupePrefix, derivePrefix } from "@/lib/itemRef";
import { normalizeHomepageUrl } from "@/lib/url";
import { IconPicker } from "./ProjectIconPicker";
import { runAction } from "./run-action";

// Wait for a pause in typing before asking for icon suggestions.
const SUGGEST_DELAY_MS = 400;

function Label({
  htmlFor,
  children,
}: {
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className="block text-[11px] font-medium uppercase tracking-wide text-neutral-400"
    >
      {children}
    </label>
  );
}

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
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The viewer's own lists' prefixes, to preview the new list's item IDs. */
  takenPrefixes: string[];
}) {
  const [name, setName] = useState("");
  const [summary, setSummary] = useState("");
  const [homepage, setHomepage] = useState("");
  // The icon the user picked in the picker; undefined until they pick one,
  // null when they removed it.
  const [picked, setPicked] = useState<string | null | undefined>(undefined);
  // Suggestions with the form contents they were made for, so they're only
  // used while the form still says the same thing.
  const [suggested, setSuggested] = useState<{ for: string; emoji: string[] }>(
    { for: "", emoji: [] },
  );
  const [pending, start] = useTransition();
  const nameRef = useRef<HTMLInputElement>(null);
  const id = useId();

  // Clear the form each time the dialog opens (React's render-time reset
  // pattern, avoiding a reset-in-effect).
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setName("");
      setSummary("");
      setHomepage("");
      setPicked(undefined);
      setSuggested({ for: "", emoji: [] });
    }
  }

  const trimmedName = name.trim();
  const homepageUrl = homepagePreview(homepage);
  const context = JSON.stringify([trimmedName, summary, homepageUrl]);
  const suggestions =
    trimmedName && suggested.for === context ? suggested.emoji : [];
  // Until the user picks, a homepage shows its favicon; otherwise the top AI
  // suggestion stands in, so the list is created with what the preview shows.
  const provisional =
    picked === undefined && !homepageUrl ? (suggestions[0] ?? null) : null;
  const icon = picked === undefined ? provisional : picked;
  const prefix = dedupePrefix(derivePrefix(trimmedName), new Set(takenPrefixes));

  useEffect(() => {
    if (!open || !trimmedName) return;
    let current = true;
    const timer = setTimeout(() => {
      void suggestNewListIconsAction({ name: trimmedName, summary, homepageUrl })
        .then((emoji) => {
          if (current) setSuggested({ for: context, emoji });
        })
        .catch(() => {});
    }, SUGGEST_DELAY_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [open, trimmedName, summary, homepageUrl, context]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!trimmedName) return;
    if (homepage.trim() && !homepageUrl) {
      toast.error("That doesn't look like a valid homepage URL.");
      return;
    }
    start(async () => {
      const created = await runAction(
        createProjectAction({ name: trimmedName, summary, homepageUrl, icon }),
        "create the list",
      );
      if (created) onOpenChange(false);
    });
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent initialFocus={nameRef}>
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center gap-2 border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
            <ResponsiveDialogTitle>New list</ResponsiveDialogTitle>
            <ResponsiveDialogDescription className="sr-only">
              Create a new list.
            </ResponsiveDialogDescription>
            <ResponsiveDialogCloseButton className="ml-auto" />
          </div>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4">
            <div className="space-y-1">
              <Label htmlFor={`${id}-name`}>Name</Label>
              <div className="flex items-center gap-2">
                <IconPicker
                  icon={icon}
                  homepageUrl={homepageUrl}
                  name={trimmedName}
                  size={20}
                  disabled={pending}
                  className="size-9 border border-input"
                  faded={Boolean(provisional)}
                  suggestions={suggestions}
                  onSelect={setPicked}
                />
                <Input
                  ref={nameRef}
                  id={`${id}-name`}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="List name, e.g. Home or Buy"
                  disabled={pending}
                />
              </div>
              {trimmedName && (
                <p className="text-xs text-muted-foreground">
                  Items will be numbered {prefix}-1, {prefix}-2, …
                </p>
              )}
            </div>

            <div className="space-y-1">
              <Label htmlFor={`${id}-summary`}>Summary</Label>
              <Textarea
                id={`${id}-summary`}
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                placeholder="What's this list for? (optional)"
                disabled={pending}
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor={`${id}-homepage`}>Homepage</Label>
              <Input
                id={`${id}-homepage`}
                value={homepage}
                onChange={(e) => setHomepage(e.target.value)}
                placeholder="example.com (optional)"
                inputMode="url"
                disabled={pending}
              />
            </div>
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
