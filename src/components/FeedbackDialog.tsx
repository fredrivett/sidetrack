"use client";

import { useId, useRef, useState, useTransition } from "react";
import { Send } from "lucide-react";
import posthog from "posthog-js";
import { toast } from "sonner";
import { sendFeedbackAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogCloseButton,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { Textarea } from "@/components/ui/textarea";
import { FEEDBACK_MAX, type FeedbackKind } from "@/lib/feedback";
import { RELEASE } from "@/lib/release";
import { cn } from "@/lib/utils";
import { runAction } from "./run-action";

const KINDS: [FeedbackKind, string, string][] = [
  ["bug", "🐛", "Bug"],
  ["idea", "💡", "Idea"],
  ["other", "💬", "Other"],
];

/** This session's PostHog replay and the sender's person page, or nulls when
 * PostHog isn't set up here. The replay starts a minute before sending. */
function posthogLinks(): { replayUrl: string | null; personUrl: string | null } {
  if (!posthog.__loaded) return { replayUrl: null, personUrl: null };
  const replayUrl = posthog.get_session_replay_url({ withTimestamp: true, timestampLookBack: 60 }) || null;
  if (!replayUrl) return { replayUrl, personUrl: null };
  // Same host and project as the replay: …/project/<token>/person/<id>.
  const person = new URL(replayUrl);
  person.search = "";
  person.pathname = person.pathname.replace(
    /\/replay\/.*$/,
    `/person/${encodeURIComponent(posthog.get_distinct_id())}`,
  );
  return { replayUrl, personUrl: person.href };
}

/** Send feedback: what it's about and what they want to say, filed in the
 * deployment's feedback list with where they were. */
export function FeedbackDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [kind, setKind] = useState<FeedbackKind>("bug");
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const id = useId();

  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setKind("bug");
      setMessage("");
    }
  }

  const trimmed = message.trim();
  const tooLong = [...trimmed].length > FEEDBACK_MAX;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!trimmed || tooLong || pending) return;
    start(async () => {
      let ref = "";
      const sent = await runAction(
        sendFeedbackAction({
          kind,
          message: trimmed,
          page: location.pathname + location.search,
          release: RELEASE || null,
          ...posthogLinks(),
        }).then((r) => {
          ref = r;
        }),
        "send your feedback",
      );
      if (!sent) return;
      posthog.capture("feedback_submitted", { kind, ref });
      toast.success("Thanks, your feedback was sent");
      onOpenChange(false);
    });
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <ResponsiveDialogContent initialFocus={messageRef}>
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center gap-2 border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
            <ResponsiveDialogTitle>Send feedback</ResponsiveDialogTitle>
            <ResponsiveDialogDescription className="sr-only">
              Tell us about a bug or an idea.
            </ResponsiveDialogDescription>
            <ResponsiveDialogCloseButton className="ml-auto" />
          </div>

          <div
            aria-busy={pending}
            className={cn(
              "min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-4",
              pending && "opacity-60",
            )}
          >
            <div role="radiogroup" aria-label="What's this about?" className="flex gap-2">
              {KINDS.map(([value, emoji, label]) => (
                <Button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={kind === value}
                  aria-disabled={pending}
                  variant={kind === value ? "secondary" : "outline"}
                  size="sm"
                  className={cn("flex-1", kind === value && "ring-2 ring-ring/40")}
                  onClick={() => !pending && setKind(value)}
                >
                  <span aria-hidden>{emoji}</span>
                  {label}
                </Button>
              ))}
            </div>
            <Textarea
              ref={messageRef}
              id={`${id}-message`}
              aria-label="Your feedback"
              value={message}
              onChange={(e) => !pending && setMessage(e.target.value)}
              readOnly={pending}
              aria-disabled={pending}
              aria-invalid={tooLong}
              className="min-h-32"
              placeholder={
                kind === "bug"
                  ? "What happened, and what did you expect?"
                  : kind === "idea"
                    ? "What would you like Sidetrack to do?"
                    : "What's on your mind?"
              }
            />
            <p className="text-xs text-muted-foreground">
              {tooLong
                ? `That's over ${FEEDBACK_MAX} characters.`
                : "Sent with your username, this page and your session, so we can see what happened."}
            </p>
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
            <Button type="submit" size="sm" disabled={!trimmed || tooLong} aria-disabled={pending}>
              <Send data-icon="inline-start" />
              {pending ? "Sending…" : "Send"}
            </Button>
          </div>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
