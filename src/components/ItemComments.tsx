"use client";

import { MoreHorizontal, Trash2 } from "lucide-react";
import { unstable_rethrow } from "next/navigation";
import {
  startTransition,
  useEffect,
  useOptimistic,
  useRef,
  useState,
  useTransition,
} from "react";
import {
  addCommentAction,
  deleteCommentAction,
  listCommentsAction,
  updateCommentAction,
} from "@/app/actions";
import type { CommentView } from "@/core/comments";
import type { AssigneeView } from "@/core/members";
import { COMMENT_MAX, type Item } from "@/core/schema";
import { modifierSymbol } from "@/lib/keyboard";
import { formatRelative } from "@/lib/time";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Kbd } from "@/components/ui/kbd";
import { EditableText } from "./EditableText";
import { Markdown } from "./Markdown";
import { runAction } from "./run-action";
import { useListAccess } from "./list-access";
import { MentionTextarea } from "./MentionTextarea";
import { AvatarStack, assigneeName } from "./UserAvatar";

/**
 * The item's comments, oldest first, with a box to add one. Loaded when the
 * dialog shows the item and again whenever the item reloads, which a comment
 * made anywhere causes (it's audited, so open boards refresh). Keyed by the
 * item where it's used, so switching items starts afresh and a save still in
 * flight can't land in another item's list.
 */
export function ItemComments({
  item,
  viewerId,
  people,
}: {
  item: Item;
  viewerId: string;
  /** Who can open the item: who a comment can mention. */
  people: AssigneeView[];
}) {
  const [comments, setComments] = useState<CommentView[] | null>(null);
  // A viewer reads the comments but doesn't write them.
  const canComment = useListAccess(item.projectId) !== "view";
  // Suggested with you last: you rarely mention yourself.
  const mentionable = [
    ...people.filter((p) => p.userId !== viewerId),
    ...people.filter((p) => p.userId === viewerId),
  ];
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // Deleting is optimistic: the comment goes at once and comes back if the
  // delete fails.
  const [shown, hide] = useOptimistic(comments, (cur, id: string) =>
    cur ? cur.filter((c) => c.id !== id) : cur,
  );
  const [, startLoad] = useTransition();
  // Counts the changes made here. A read that started before one is dropped,
  // so it can't put back what the change undid; the change's own refresh
  // reads again.
  const changes = useRef(0);

  useEffect(() => {
    let stale = false;
    const seen = changes.current;
    startLoad(async () => {
      const loaded = await runAction(
        listCommentsAction(item.id).then(
          (rows) => {
            if (!stale && seen === changes.current) setComments(rows);
          },
          // Once the dialog has moved on, a failed load is moot, but a
          // signed-out session's redirect to /login still goes through.
          (error) => {
            unstable_rethrow(error);
            if (!stale) throw error;
          },
        ),
        "load the comments",
      );
      if (!loaded && !stale) setFailed(true);
    });
    return () => {
      stale = true;
    };
  }, [item, attempt]);

  // Before the comments have loaded there's nothing to change: the change's
  // refresh loads them with it.
  function change(update: (cur: CommentView[]) => CommentView[]) {
    changes.current++;
    setComments((cur) => cur && update(cur));
  }

  function remove(id: string) {
    startTransition(async () => {
      hide(id);
      if (await runAction(deleteCommentAction(id), "delete the comment")) {
        change((cur) => cur.filter((c) => c.id !== id));
      }
    });
  }

  return (
    <div className="space-y-3">
      {shown === null ? (
        failed ? (
          <p className="text-sm text-neutral-400">
            Couldn’t load the comments.{" "}
            <button
              type="button"
              onClick={() => {
                setFailed(false);
                setAttempt((a) => a + 1);
              }}
              className="font-medium text-neutral-600 hover:underline dark:text-neutral-300"
            >
              Try again
            </button>
          </p>
        ) : (
          <p className="text-sm text-neutral-400">Loading…</p>
        )
      ) : (
        shown.length > 0 && (
          <ul className="space-y-2">
            {shown.map((c) => (
              <CommentCard
                key={c.id}
                comment={c}
                people={mentionable}
                own={
                  c.userId === viewerId
                    ? {
                        // Someone who can no longer comment can still take
                        // back what they wrote, but not change it.
                        onEdited: canComment
                          ? (comment) =>
                              change((cur) => cur.map((x) => (x.id === comment.id ? comment : x)))
                          : undefined,
                        onDelete: () => remove(c.id),
                      }
                    : undefined
                }
              />
            ))}
          </ul>
        )
      )}
      {canComment ? (
        <Composer
          itemId={item.id}
          title={item.title}
          people={mentionable}
          onAdded={(comment) => change((cur) => [...cur, comment])}
        />
      ) : (
        <p className="text-xs text-neutral-400">You can view this list, but not comment on it.</p>
      )}
    </div>
  );
}

/**
 * One comment as a card: who wrote it and when, then what it says. `own`
 * gives it a ⋯ menu to delete it, and with `onEdited` makes it editable in
 * place, for the viewer's own
 * comments on the item they're looking at. `context` goes between the header
 * and the text, such as the item a comment is on in a feed across items.
 */
export function CommentCard({
  comment: c,
  people,
  own,
  context,
  clamp = false,
}: {
  comment: CommentView;
  /** Who can open its item, whose `@username` shows as a mention, and
   * who editing it suggests. */
  people?: AssigneeView[];
  own?: { onEdited?: (comment: CommentView) => void; onDelete: () => void };
  context?: React.ReactNode;
  /** Cut it off after a few lines, so a long comment can't fill a feed. */
  clamp?: boolean;
}) {
  const users = c.author ? [c.author] : [];
  const onEdited = own?.onEdited;
  const agents = c.agentName ? [{ id: c.id, name: c.agentName }] : [];
  return (
    <li className="group/comment rounded-lg bg-neutral-50 px-3 pt-2 pb-2.5 ring-1 ring-neutral-950/5 dark:bg-white/[0.03] dark:ring-white/5">
      <div className="flex h-6 items-center gap-2 text-[13px]">
        {/* The agent ahead of the person it wrote for, as in Activity. */}
        {(users.length > 0 || agents.length > 0) && (
          <AvatarStack users={users} agents={agents} size={20} ringClassName="ring-neutral-50 dark:ring-neutral-900" />
        )}
        <span className="min-w-0 truncate">
          <span className="font-medium text-neutral-900 dark:text-neutral-100">
            {c.author ? assigneeName(c.author) : "Unknown"}
          </span>
          {c.agentName && <span className="text-neutral-500"> via {c.agentName}</span>}
        </span>
        <span
          className="shrink-0 text-neutral-400"
          title={new Date(c.editedAt ?? c.createdAt).toLocaleString()}
        >
          {formatRelative(c.createdAt)}
          {c.editedAt !== null ? " (edited)" : ""}
        </span>
        {own && (
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label="Comment actions"
              // Out of the way until you point at the comment; always there
              // on touch, which can't hover.
              className="ml-auto -mr-1 flex size-6 shrink-0 items-center justify-center rounded-md text-neutral-400 opacity-0 transition group-hover/comment:opacity-100 hover:bg-neutral-200/70 hover:text-neutral-700 focus-visible:opacity-100 data-popup-open:opacity-100 [@media(hover:none)]:opacity-100 dark:hover:bg-neutral-700/60 dark:hover:text-neutral-200"
            >
              <MoreHorizontal className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem variant="destructive" onClick={own.onDelete}>
                <Trash2 />
                Delete comment
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {context}
      <div
        className={`mt-1 break-words text-sm text-neutral-700 dark:text-neutral-200 ${clamp ? "line-clamp-6" : ""}`}
      >
        {onEdited ? (
          // Your own comments edit in place, like the description: click,
          // then ⌘Enter or click away to save.
          <EditableText
            value={c.body}
            onSave={(next) =>
              runAction(updateCommentAction(c.id, next).then(onEdited), "save the comment")
            }
            multiline
            mentions={people}
            required
            maxLength={COMMENT_MAX}
            className="block w-full"
            inputClassName="w-full bg-white text-sm dark:bg-neutral-900"
            renderValue={(body) => <Markdown mentions={people}>{body}</Markdown>}
          />
        ) : (
          <Markdown mentions={people}>{c.body}</Markdown>
        )}
      </div>
    </li>
  );
}

/**
 * The box a new comment is written in, with its send button inside. It holds
 * while the comment saves: the dialog stays open, so the box is where you're
 * looking. Typing `@` suggests people to mention (MentionTextarea).
 */
function Composer({
  itemId,
  title,
  people,
  onAdded,
}: {
  itemId: string;
  title: string;
  people: AssigneeView[];
  onAdded: (comment: CommentView) => void;
}) {
  const [draft, setDraft] = useState("");
  const [saving, start] = useTransition();
  const empty = !draft.trim();

  function submit() {
    if (saving || empty) return;
    start(async () => {
      await runAction(
        addCommentAction(itemId, draft).then((comment) => {
          setDraft("");
          onAdded(comment);
        }),
        `comment on “${title}”`,
      );
    });
  }

  return (
    <div
      aria-busy={saving || undefined}
      // One line until it's focused or holds a draft, then room to write
      // and the button to send it.
      className={`group/composer rounded-lg border border-input bg-background transition-[color,box-shadow,opacity] focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30 ${saving ? "opacity-60" : ""}`}
    >
      <MentionTextarea
        people={people}
        value={draft}
        onValueChange={setDraft}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
        aria-disabled={saving || undefined}
        placeholder="Leave a comment…"
        maxLength={COMMENT_MAX}
        aria-label="Add a comment"
        className={`flex field-sizing-content max-h-60 w-full resize-none bg-transparent px-3 py-1.5 text-base outline-none transition-colors placeholder:text-muted-foreground focus:min-h-16 focus:pb-0 md:text-sm ${empty ? "min-h-9" : "min-h-16 pb-0"}`}
      />
      <div
        className={`justify-end px-2 pb-2 ${empty && !saving ? "hidden group-focus-within/composer:flex" : "flex"}`}
      >
        <Button
          type="button"
          size="sm"
          onClick={submit}
          // Not `disabled` while saving, which would drop keyboard focus.
          disabled={empty && !saving}
          aria-disabled={saving || undefined}
        >
          {saving ? "Commenting…" : "Comment"}
          <Kbd variant="primary" className="-mr-1">
            {modifierSymbol()}↵
          </Kbd>
        </Button>
      </div>
    </div>
  );
}
