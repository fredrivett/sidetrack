"use client";

import { MoreHorizontal, Trash2 } from "lucide-react";
import { unstable_rethrow } from "next/navigation";
import {
  startTransition,
  useEffect,
  useId,
  useLayoutEffect,
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
import { mentionQueryAt, suggestPeople } from "@/lib/mentions";
import { formatRelative } from "@/lib/time";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Kbd } from "@/components/ui/kbd";
import { Textarea } from "@/components/ui/textarea";
import { EditableText } from "./EditableText";
import { Markdown } from "./Markdown";
import { runAction } from "./run-action";
import { AvatarStack, assigneeName, UserAvatar } from "./UserAvatar";

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
                people={people}
                own={
                  c.userId === viewerId
                    ? {
                        onEdited: (comment) =>
                          change((cur) => cur.map((x) => (x.id === comment.id ? comment : x))),
                        onDelete: () => remove(c.id),
                      }
                    : undefined
                }
              />
            ))}
          </ul>
        )
      )}
      <Composer
        itemId={item.id}
        title={item.title}
        // You last: you rarely mention yourself.
        people={[
          ...people.filter((p) => p.userId !== viewerId),
          ...people.filter((p) => p.userId === viewerId),
        ]}
        onAdded={(comment) => change((cur) => [...cur, comment])}
      />
    </div>
  );
}

/**
 * One comment as a card: who wrote it and when, then what it says. `own`
 * makes it editable in place with a ⋯ menu to delete it, for the viewer's own
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
  /** Who can open its item, whose `@username` shows as a mention. */
  people?: AssigneeView[];
  own?: { onEdited: (comment: CommentView) => void; onDelete: () => void };
  context?: React.ReactNode;
  /** Cut it off after a few lines, so a long comment can't fill a feed. */
  clamp?: boolean;
}) {
  const users = c.author ? [c.author] : [];
  const agents = c.agentName ? [{ id: c.id, name: c.agentName }] : [];
  return (
    <li className="group/comment rounded-lg border border-neutral-200 bg-neutral-50/70 px-3 pt-2 pb-2.5 dark:border-neutral-800 dark:bg-neutral-800/30">
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
        {own ? (
          // Your own comments edit in place, like the description: click,
          // then ⌘Enter or click away to save.
          <EditableText
            value={c.body}
            onSave={(next) =>
              runAction(updateCommentAction(c.id, next).then(own.onEdited), "save the comment")
            }
            multiline
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
 * looking. Typing `@` suggests the people who can open the item, as Linear
 * and Slack do: ↑↓ to choose, Enter or Tab to put in their `@username`, Esc
 * to carry on typing without one.
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
  const box = useRef<HTMLTextAreaElement>(null);
  // The `@…` before the caret, and which suggestion is highlighted.
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [active, setActive] = useState(0);
  // The `@` Esc dismissed, so its suggestions stay away while you type on.
  const [dismissed, setDismissed] = useState<number | null>(null);
  // Where the caret goes once a picked mention is in the text.
  const caretAfter = useRef<number | null>(null);
  const listId = useId();

  const suggestions =
    mention && mention.start !== dismissed ? suggestPeople(people, mention.query) : [];
  const open = suggestions.length > 0;
  const highlighted = Math.min(active, suggestions.length - 1);

  useLayoutEffect(() => {
    if (caretAfter.current === null || !box.current) return;
    box.current.setSelectionRange(caretAfter.current, caretAfter.current);
    caretAfter.current = null;
  }, [draft]);

  // Follows the caret, which typing, clicking and the arrow keys all move.
  function track(el: HTMLTextAreaElement) {
    const next = mentionQueryAt(el.value, el.selectionStart);
    if (next?.start !== mention?.start) setActive(0);
    if (!next) setDismissed(null);
    setMention(next);
  }

  function pick(person: AssigneeView) {
    const el = box.current;
    if (saving || !mention || !el) return;
    const text = `@${person.displayUsername ?? person.username} `;
    const next = draft.slice(0, mention.start) + text + draft.slice(el.selectionStart);
    // Like typing past maxLength: no room, no change. Counted as the server
    // counts, in characters.
    if ([...next].length > COMMENT_MAX) return;
    caretAfter.current = mention.start + text.length;
    setDraft(next);
    setMention(null);
  }

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
      className={`relative rounded-lg border border-input transition-[color,box-shadow,opacity] focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30 ${saving ? "opacity-60" : ""}`}
    >
      <Textarea
        ref={box}
        value={draft}
        onChange={(e) => {
          if (saving) return;
          setDraft(e.target.value);
          track(e.target);
        }}
        onSelect={(e) => track(e.currentTarget)}
        onBlur={() => setMention(null)}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (open && !e.metaKey && !e.ctrlKey) {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              const step = e.key === "ArrowDown" ? 1 : -1;
              setActive((highlighted + step + suggestions.length) % suggestions.length);
              return;
            }
            if (e.key === "Enter" || e.key === "Tab") {
              e.preventDefault();
              pick(suggestions[highlighted]);
              return;
            }
            if (e.key === "Escape") {
              // Closes the suggestions, not the dialog.
              e.preventDefault();
              e.stopPropagation();
              setDismissed(mention?.start ?? null);
              return;
            }
          }
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            submit();
          }
        }}
        aria-disabled={saving || undefined}
        placeholder="Leave a comment…"
        maxLength={COMMENT_MAX}
        aria-label="Add a comment"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? `${listId}-${highlighted}` : undefined}
        className="max-h-60 min-h-12 resize-none rounded-none border-0 bg-transparent px-3 pt-2.5 pb-0 focus-visible:ring-0 dark:bg-transparent"
      />
      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label="People to mention"
          // Above the box, as in Slack: the box sits at the foot of the
          // dialog, whose scrolling would cut off a list below it.
          className="absolute right-0 bottom-full left-0 z-50 mb-1 rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10"
        >
          {suggestions.map((p, i) => (
            <li
              key={p.userId}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === highlighted}
              // Keeps focus (and the caret) in the box.
              onMouseDown={(e) => e.preventDefault()}
              onMouseMove={() => setActive(i)}
              onClick={() => pick(p)}
              className="flex cursor-default items-center gap-1.5 rounded-md px-1.5 py-1 text-sm select-none aria-selected:bg-accent aria-selected:text-accent-foreground"
            >
              <UserAvatar user={p} size={18} />
              <span className="truncate">{p.name ?? assigneeName(p)}</span>
              {p.name && (
                <span className="shrink-0 text-muted-foreground">
                  @{p.displayUsername ?? p.username}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="flex justify-end px-2 pb-2">
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
