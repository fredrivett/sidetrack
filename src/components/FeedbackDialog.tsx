"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { CircleCheck, Send } from "lucide-react";
import posthog from "posthog-js";
import { toast } from "sonner";
import { addFeedbackFollowUpAction, sendFeedbackAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogCloseButton,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { Input } from "@/components/ui/input";
import { LoadingEllipsis } from "@/components/ui/loading-ellipsis";
import { Textarea } from "@/components/ui/textarea";
import { useDraft } from "@/components/use-draft";
import {
  FEEDBACK_AREAS,
  FEEDBACK_MAX,
  type FeedbackArea,
  type FeedbackKind,
  type FeedbackRating,
} from "@/lib/feedback";
import type { FollowUp } from "@/lib/feedbackFollowUps";
import { RELEASE } from "@/lib/release";
import { cn } from "@/lib/utils";
import { aiRead } from "./ai-read";
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

/** Feedback that's been filed, and Claude's follow-up questions about it:
 * null while it's still asking. */
interface Sent {
  itemId: string;
  ref: string;
  questions: FollowUp[] | null;
}

/** Send feedback: what it's about and what they want to say, filed in the
 * deployment's feedback list with where they were. With `about`, it's a
 * thumbs up or down on that part of the app, tagged with it, and saying why
 * is optional. Once it's filed, the dialog may ask a few follow-up questions,
 * whose answers are added to the same item; skipping them loses nothing. */
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
  const messageDraft = useDraft("feedback:message");
  const message = messageDraft.value;
  const [pending, start] = useTransition();
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const id = useId();
  const [sent, setSent] = useState<Sent | null>(null);
  // The item the dialog is asking about now, so a late answer for one it's
  // closed on is dropped.
  const asking = useRef<string | null>(null);
  useEffect(() => {
    if (!open) asking.current = null;
  }, [open]);

  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setKind("bug");
      setSent(null);
    }
  }

  const trimmed = message.trim();
  const tooLong = [...trimmed].length > FEEDBACK_MAX;
  const canSend = (trimmed || about) && !tooLong;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSend || pending) return;
    start(async () => {
      let filed = { itemId: "", ref: "" };
      const ok = await runAction(
        sendFeedbackAction({
          kind: about ? "other" : kind,
          about,
          message: trimmed,
          page: location.pathname + location.search,
          release: RELEASE || null,
          ...posthogLinks(),
        }).then((r) => {
          filed = r;
        }),
        "send your feedback",
      );
      if (!ok) return;
      messageDraft.clear();
      posthog.capture("feedback_submitted", { kind, ref: filed.ref, area: about?.area, rating: about?.rating });
      // A thumbs up is a kind word, not a report to fill in: no questions,
      // and no Claude call or "Checking…" wait to find there are none.
      if (about?.rating === "up") {
        toast.success("Thanks, your feedback was sent");
        onOpenChange(false);
        return;
      }
      // It's filed. Claude's questions are an optional extra (AI suggestions
      // never hold), so a failure or nothing to ask just closes as before.
      setSent({ ...filed, questions: null });
      asking.current = filed.itemId;
      const questions = await aiRead("feedbackFollowUps", { itemId: filed.itemId }).catch(() => []);
      if (asking.current !== filed.itemId) return;
      if (!questions.length) {
        toast.success("Thanks, your feedback was sent");
        onOpenChange(false);
        return;
      }
      posthog.capture("feedback_follow_ups_shown", { ref: filed.ref, count: questions.length });
      setSent({ ...filed, questions });
    });
  }

  if (sent) {
    return (
      <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
        <ResponsiveDialogContent
          // Optional follow-up questions, mostly answered by pressing.
          initialFocus={null}
        >
          <FollowUpForm sent={sent} onDone={() => onOpenChange(false)} />
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    );
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
              draft={messageDraft}
              onChange={(e) => !pending && messageDraft.set(e.target.value)}
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
              onClick={() => {
                messageDraft.clear();
                onOpenChange(false);
              }}
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

/** The longest answer typed in, as core allows. */
const TYPED_MAX = 200;

/** Claude's questions about feedback that's filed as `sent.ref`, with
 * answers to tap or type and room for anything else; Done skips them. */
function FollowUpForm({ sent, onDone }: { sent: Sent; onDone: () => void }) {
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const noteDraft = useDraft(`feedback:${sent.itemId}:note`);
  const note = noteDraft.value;
  const [pending, start] = useTransition();
  const id = useId();
  const questions = sent.questions ?? [];
  const loading = sent.questions === null;
  const given = questions
    .map((q, i) => ({ question: q.question, answer: (answers[i] ?? "").trim() }))
    .filter((a) => a.answer);
  const canAdd = !loading && (given.length > 0 || note.trim()) && [...note.trim()].length <= FEEDBACK_MAX;

  function add(e: React.FormEvent) {
    e.preventDefault();
    if (!canAdd || pending) return;
    start(async () => {
      const ok = await runAction(
        addFeedbackFollowUpAction({ itemId: sent.itemId, answers: given, note: note.trim() }),
        "add to your feedback",
      );
      if (!ok) return;
      noteDraft.clear();
      posthog.capture("feedback_follow_up_added", { ref: sent.ref, answered: given.length });
      toast.success(`Thanks, that's added to your feedback`);
      onDone();
    });
  }

  function done() {
    if (pending) return;
    noteDraft.clear();
    toast.success("Thanks, your feedback was sent");
    onDone();
  }

  return (
    <form onSubmit={add} className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
        <ResponsiveDialogTitle>
          <span data-replay-safe className="flex items-center gap-1.5">
            <CircleCheck className="size-4 text-green-600 dark:text-green-500" aria-hidden />
            Sent as {sent.ref}
          </span>
        </ResponsiveDialogTitle>
        <ResponsiveDialogDescription className="sr-only">
          Your feedback is sent. Answer a few questions about it, if you like.
        </ResponsiveDialogDescription>
        <ResponsiveDialogCloseButton className="ml-auto" />
      </div>

      <div
        aria-busy={loading || pending}
        className={cn(
          "min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4",
          pending && "opacity-60",
        )}
      >
        {loading ? (
          <p data-replay-safe className="text-sm text-muted-foreground">
            Thanks. Checking if we have any quick questions
            <LoadingEllipsis />
          </p>
        ) : (
          <>
            <p data-replay-safe className="text-sm text-muted-foreground">
              Thanks. A few quick questions would help us act on it, if you have a moment.
            </p>
            {questions.map((q, i) => {
              const picked = answers[i] ?? "";
              const typed = picked && !q.answers.includes(picked) ? picked : "";
              return (
                <fieldset key={i} className="space-y-2" aria-disabled={pending}>
                  <legend data-replay-safe className="text-sm">
                    {q.question}
                  </legend>
                  <div data-replay-safe className="flex flex-wrap gap-1.5">
                    {q.answers.map((a) => (
                      <Button
                        key={a}
                        type="button"
                        size="sm"
                        variant={picked === a ? "secondary" : "outline"}
                        aria-pressed={picked === a}
                        aria-disabled={pending}
                        className={cn("h-7 rounded-full px-3", picked === a && "ring-2 ring-ring/40")}
                        onClick={() =>
                          !pending && setAnswers((prev) => ({ ...prev, [i]: picked === a ? "" : a }))
                        }
                      >
                        {a}
                      </Button>
                    ))}
                  </div>
                  <Input
                    aria-label={`Your own answer: ${q.question}`}
                    value={typed}
                    maxLength={TYPED_MAX}
                    readOnly={pending}
                    placeholder="Or say something else"
                    onChange={(e) => !pending && setAnswers((prev) => ({ ...prev, [i]: e.target.value }))}
                  />
                </fieldset>
              );
            })}
            <div className="space-y-2">
              <label htmlFor={`${id}-note`} data-replay-safe className="text-sm">
                Anything else?
              </label>
              <Textarea
                id={`${id}-note`}
                draft={noteDraft}
                onChange={(e) => !pending && noteDraft.set(e.target.value)}
                readOnly={pending}
                aria-disabled={pending}
                placeholder="Optional"
                className="min-h-16"
              />
            </div>
          </>
        )}
      </div>

      <div data-replay-safe className="flex shrink-0 justify-end gap-2 border-t border-neutral-200 px-4 py-3 dark:border-neutral-800">
        <Button type="button" variant="outline" size="sm" onClick={done} disabled={pending}>
          Done
        </Button>
        <Button type="submit" size="sm" disabled={!canAdd} aria-disabled={pending}>
          {pending ? "Adding…" : `Add to ${sent.ref}`}
        </Button>
      </div>
    </form>
  );
}
