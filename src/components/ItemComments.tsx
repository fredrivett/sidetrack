"use client";

import { MoreHorizontal, Trash2 } from "lucide-react";
import {
  startTransition,
  useEffect,
  useOptimistic,
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
import type { Item } from "@/core/schema";
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
import { Textarea } from "@/components/ui/textarea";
import { EditableText } from "./EditableText";
import { Markdown } from "./Markdown";
import { runAction } from "./run-action";
import { AvatarStack, assigneeName } from "./UserAvatar";

/**
 * The item's comments, oldest first, with a box to add one. Loaded when the
 * dialog shows the item and again whenever the item reloads, which a comment
 * made anywhere causes (it's audited, so open boards refresh).
 */
export function ItemComments({
  item,
  viewerId,
}: {
  item: Item;
  viewerId: string;
}) {
  const [comments, setComments] = useState<CommentView[] | null>(null);
  // Deleting is optimistic: the comment goes at once and comes back if the
  // delete fails.
  const [shown, hide] = useOptimistic(comments, (cur, id: string) =>
    cur ? cur.filter((c) => c.id !== id) : cur,
  );
  const [, startLoad] = useTransition();

  // Switching to another item drops the last one's comments rather than
  // showing them until the new ones load.
  const [prevId, setPrevId] = useState(item.id);
  if (prevId !== item.id) {
    setPrevId(item.id);
    setComments(null);
  }

  useEffect(() => {
    let stale = false;
    startLoad(async () => {
      await runAction(
        listCommentsAction(item.id).then(
          (rows) => {
            if (!stale) setComments(rows);
          },
          // Once the dialog has moved on, a failed load is moot.
          (error) => {
            if (!stale) throw error;
          },
        ),
        "load the comments",
      );
    });
    return () => {
      stale = true;
    };
  }, [item]);

  function replace(comment: CommentView) {
    setComments(
      (cur) => cur?.map((c) => (c.id === comment.id ? comment : c)) ?? cur,
    );
  }

  function remove(id: string) {
    startTransition(async () => {
      hide(id);
      if (await runAction(deleteCommentAction(id), "delete the comment")) {
        setComments((cur) => cur?.filter((c) => c.id !== id) ?? cur);
      }
    });
  }

  return (
    <div className="space-y-3">
      {shown === null ? (
        <p className="text-sm text-neutral-400">Loading…</p>
      ) : (
        shown.length > 0 && (
          <ul className="space-y-2">
            {shown.map((c) => (
              <CommentRow
                key={c.id}
                comment={c}
                mine={c.userId === viewerId}
                onEdited={replace}
                onDelete={() => remove(c.id)}
              />
            ))}
          </ul>
        )
      )}
      <Composer
        // A fresh box per item, so a half-written comment doesn't follow you
        // to the next one.
        key={item.id}
        itemId={item.id}
        title={item.title}
        onAdded={(comment) => setComments((cur) => [...(cur ?? []), comment])}
      />
    </div>
  );
}

function CommentRow({
  comment: c,
  mine,
  onEdited,
  onDelete,
}: {
  comment: CommentView;
  mine: boolean;
  onEdited: (comment: CommentView) => void;
  onDelete: () => void;
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
        {mine && (
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
              <DropdownMenuItem variant="destructive" onClick={onDelete}>
                <Trash2 />
                Delete comment
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <div className="mt-1 break-words text-sm text-neutral-700 dark:text-neutral-200">
        {mine ? (
          // Your own comments edit in place, like the description: click,
          // then ⌘Enter or click away to save.
          <EditableText
            value={c.body}
            onSave={(next) =>
              runAction(updateCommentAction(c.id, next).then(onEdited), "save the comment")
            }
            multiline
            required
            className="block w-full"
            inputClassName="w-full bg-white text-sm dark:bg-neutral-900"
            renderValue={(body) => <Markdown>{body}</Markdown>}
          />
        ) : (
          <Markdown>{c.body}</Markdown>
        )}
      </div>
    </li>
  );
}

/**
 * The box a new comment is written in, with its send button inside. It holds
 * while the comment saves: the dialog stays open, so the box is where you're
 * looking.
 */
function Composer({
  itemId,
  title,
  onAdded,
}: {
  itemId: string;
  title: string;
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
      className={`rounded-lg border border-input transition-[color,box-shadow,opacity] focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30 ${saving ? "opacity-60" : ""}`}
    >
      <Textarea
        value={draft}
        onChange={(e) => !saving && setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
        aria-disabled={saving || undefined}
        placeholder="Leave a comment…"
        aria-label="Add a comment"
        className="max-h-60 min-h-12 resize-none rounded-none border-0 bg-transparent px-3 pt-2.5 pb-0 focus-visible:ring-0 dark:bg-transparent"
      />
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
