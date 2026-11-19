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
import {
  FEEDBACK_AREAS,
  FEEDBACK_MAX,
  type FeedbackArea,
  type FeedbackKind,
  type FeedbackRating,
} from "@/lib/feedback";
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

/** A thumbs up or down on one part of the app, and what it showed them. */
export interface FeedbackAbout {
  area: FeedbackArea;
  rating: FeedbackRating;
  context: string;
}

/** Send feedback: what it's about and what they want to say, filed in the
 * deployment's feedback list with where they were. With `about`, it's a
 * thumbs up or down on that part of the app, tagged with it, and saying why
 * is optional. */
export function FeedbackDialog({
  open,
  onOpenChange,
  about = null,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  about?: FeedbackAbout | null;
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
  const canSend = (trimmed || about) && !tooLong;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSend || pending) return;
    start(async () => {
      let ref = "";
      const sent = await runAction(
        sendFeedbackAction({
          kind: about ? "other" : kind,
          about,
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
      posthog.capture("feedback_submitted", { kind, ref, area: about?.area, rating: about?.rating });
      toast.success("Thanks, your feedback was sent");
      onOpenChange(false);
    });
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <ResponsiveDialogContent initialFocus={messageRef}>
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center gap-2 border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
            <ResponsiveDialogTitle>
              <span data-replay-safe>
                {about ? `${about.rating === "up" ? "👍" : "👎"} ${FEEDBACK_AREAS[about.area]}` : "Send feedback"}
              </span>
            </ResponsiveDialogTitle>
            <ResponsiveDialogDescription className="sr-only">
              {about ? "Say what worked or what didn't, if you like." : "Tell us about a bug or an idea."}
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
            {about ? (
              <blockquote className="max-h-32 overflow-y-auto border-l-2 border-neutral-200 pl-3 text-sm text-muted-foreground dark:border-neutral-700">
                {about.context}
              </blockquote>
            ) : (
            <div role="radiogroup" aria-label="What's this about?" data-replay-safe className="flex gap-2">
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
            )}
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
                about
                  ? about.rating === "up"
                    ? "What did it get right? (optional)"
                    : "What was off? (optional)"
                  : kind === "bug"
                  ? "What happened, and what did you expect?"
                  : kind === "idea"
                    ? "What would you like Sidetrack to do?"
                    : "What's on your mind?"
              }
            />
            <p data-replay-safe className="text-xs text-muted-foreground">
              {tooLong
                ? `That's over ${FEEDBACK_MAX} characters.`
                : "Sent with your username, this page and your session, so we can see what happened."}
            </p>
          </div>

          <div data-replay-safe className="flex shrink-0 justify-end gap-2 border-t border-neutral-200 px-4 py-3 dark:border-neutral-800">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={!canSend} aria-disabled={pending}>
              <Send data-icon="inline-start" />
              {pending ? "Sending…" : "Send"}
            </Button>
          </div>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
