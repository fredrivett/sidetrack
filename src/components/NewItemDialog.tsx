"use client";

import { Check, Copy, IndentIncrease, List, ListPlus, Plus, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { toast } from "sonner";
import { addItemAction, createProjectAction } from "@/app/actions";
import type { AiReadResult } from "@/app/api/ai/reads";
import type { LabelEmoji } from "@/core/labels";
import type { AssigneeView } from "@/core/members";
import type { Item } from "@/core/schema";
import { toggleAssignee } from "@/lib/assignees";
import { cn } from "@/lib/utils";
import { formatItemRef } from "@/lib/itemRef";
import type { Repeat } from "@/lib/repeat";
import { type Due, dueLabel, parseDue, sameDue } from "@/lib/time";
import { cutTitle, placeParts, ruleParts, type TitlePart } from "@/lib/titleParts";
import { Button } from "@/components/ui/button";
import { MentionTextarea } from "@/components/MentionTextarea";
import { useDraft } from "@/components/use-draft";
import { useStoredState } from "@/components/use-stored-state";
import { Input } from "@/components/ui/input";
import {
  ResponsiveDialog,
  ResponsiveDialogBackButton,
  ResponsiveDialogCloseButton,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogTitle,
  ResponsiveDialogViews,
} from "@/components/ui/responsive-dialog";
import { useCopy } from "@/components/ui/use-copy";
import { AssigneeOptions } from "./AssigneeOptions";
import { CreatableCombobox } from "./CreatableCombobox";
import { useToday } from "./use-day-start";
import type { RenderItem } from "./GreetingDialog";
import { useItemTrail } from "./use-item-detail-dialog";
import {
  AssigneeChip,
  CHIP,
  DueChip,
  EMPTY_CHIP,
  Field,
  RepeatChip,
  SUGGESTED_CHIP,
} from "./DialogFields";
import { LabelChips, useListLabels } from "./Labels";
import type { ProjectView } from "./Kanban";
import { ProjectIcon } from "./ProjectIcon";
import { runAction } from "./run-action";
import { useItemShortcuts } from "./useItemShortcuts";
import { aiRead } from "./ai-read";
import { shortLabel } from "./RepeatBadge";
import { PART_TONE, PartButton, type ShownPart, TitleField } from "./TitleField";
import { assigneeName } from "./UserAvatar";

// Wait for a pause in typing before asking Jev about the draft.
const SUGGEST_DELAY_MS = 400;

type Suggestion = AiReadResult<"newItem">;
type ItemHint = NonNullable<Suggestion["parent"]>;

/**
 * The toast confirming an add. The whole toast opens the item: the title's
 * button stretches over it with ::after (Sonner's toast is the positioned
 * box). The ref tag sits above that, so clicking it copies the ref instead.
 */
function AddedToast({
  title,
  itemRef,
  onOpen,
}: {
  title: string;
  itemRef: string;
  onOpen: () => void;
}) {
  const { copied, copy } = useCopy(itemRef);
  return (
    <span className="flex items-center gap-2">
      <button
        type="button"
        onClick={onOpen}
        className="min-w-0 truncate text-left after:absolute after:inset-0 after:cursor-pointer"
      >
        Added “{title}”
      </button>
      <button
        type="button"
        onClick={() => void copy()}
        title="Copy ID"
        className="relative inline-flex shrink-0 items-center gap-1 rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-[11px] tracking-wide text-neutral-600 transition hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
      >
        {copied ? (
          <Check className="size-3 opacity-70" />
        ) : (
          <Copy className="size-3 opacity-70" />
        )}
        {copied ? "Copied" : itemRef}
      </button>
    </span>
  );
}

const NO_SUB_ITEMS: string[] = [];

/**
 * What's been picked in New item. The fields Jev can fill in are undefined
 * until someone picks one, clearing it included: until then a suggestion or
 * the default stands in, and once picked, nothing replaces it.
 */
type Picked = {
  projectId: string;
  parent: { projectId: string; item: ItemHint } | null;
  labels?: string[];
  labelEmoji: Record<string, LabelEmoji>;
  assigneeIds?: string[];
  due?: Due | null;
  repeat?: Repeat | null;
  /** Jev's suggestions cleared, for this item. */
  noSuggestions?: boolean;
  /** Title parts (by partKey) kept in the title, and ones that set nothing. */
  titleKept?: string[];
  titleDropped?: string[];
  /** The open item Jev said it repeats, ignored for this item. */
  duplicateIgnored?: string;
};
/** A setter for each field of Picked, taking a value or an update. */
function pickers(setPicked: (update: (cur: Picked) => Picked) => void) {
  const field =
    <K extends keyof Picked>(name: K) =>
    (next: Picked[K] | ((current: Picked[K]) => Picked[K])) =>
      setPicked((cur) => ({
        ...cur,
        [name]: typeof next === "function" ? (next as (c: Picked[K]) => Picked[K])(cur[name]) : next,
      }));
  return {
    projectId: field("projectId"),
    parent: field("parent"),
    labels: field("labels"),
    labelEmoji: field("labelEmoji"),
    assigneeIds: field("assigneeIds"),
    repeat: field("repeat"),
  };
}

const NOTHING_PICKED: Picked = {
  projectId: "",
  parent: null,
  labelEmoji: {},
};
const NO_IDS: string[] = [];
const NO_PARTS: TitlePart[] = [];
/** Which part a choice about it is for, through later readings of the title. */
const partKey = (p: TitlePart) => `${p.field}:${p.text.toLowerCase()}`;
const sameRepeat = (a: Repeat | null, b: Repeat) =>
  a !== null &&
  a.every === b.every &&
  a.unit === b.unit &&
  (a.on ?? null) === (b.on ?? null) &&
  (a.day ?? null) === (b.day ?? null);
const NO_PEOPLE: AssigneeView[] = [];

export function NewItemDialog({
  open,
  onOpenChange,
  onOpenItem,
  findItem,
  renderItem,
  projects,
  assigneesByProject,
  viewerId,
  initialProjectId,
  dueToday = false,
  shownOnBoard,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Opens an added item, from its toast. */
  onOpenItem: (item: Item) => void;
  /** An item on the board, by id: the one Jev says it repeats, to show. */
  findItem: (id: string) => Item | undefined;
  /** An item's details, as a view of this dialog. */
  renderItem: RenderItem;
  projects: ProjectView[];
  assigneesByProject: Record<string, AssigneeView[]>;
  viewerId: string;
  initialProjectId: string | null;
  /** Opens due today, as from the Brief's "+", and keeps today for each next item. */
  dueToday?: boolean;
  /**
   * Whether an added item, with this many new sub-items, shows on the board
   * under the viewer's filters, for its toast.
   */
  shownOnBoard: (item: Item, subItems: number) => boolean;
}) {
  // What's picked is part of the draft too, kept until it's added or the
  // dialog's cancelled. A field left unset uses the dialog's own default.
  const [picked, setPicked] = useStoredState("draft:new-item:picked", NOTHING_PICKED);
  const pick = useMemo(() => pickers(setPicked), [setPicked]);
  // The list the dialog was opened from, for when none is picked.
  const [openedFrom, setOpenedFrom] = useState(initialProjectId ?? "");
  // The list the user chose, or the one the dialog was opened from; "" until
  // then, while Jev's suggestion (if any) stands in.
  const pickedProjectId = picked.projectId || openedFrom;
  const setPickedProjectId = pick.projectId;
  // A parent the user accepted from a suggestion, with the list it's in.
  const parent = picked.parent;
  const setParent = pick.parent;
  // Jev's latest suggestion, with the list and adds it was asked for and
  // the draft it was asked about. It's shown while more is typed, until the
  // next answer replaces it, so the fields it fills don't blink empty at
  // each key; another list or another item starts afresh. Only an answer
  // for the draft as it is now is added with it (`fresh`).
  const [suggested, setSuggested] = useState<{
    for: string;
    draft: string;
    value: Suggestion;
  } | null>(null);
  // What's typed is kept until it's added or the dialog's cancelled, so a
  // reload (a deploy's, say) or the app closing in the background loses none.
  const { value: title, set: setTitle } = useDraft("new-item:title");
  const descriptionDraft = useDraft("new-item:description");
  const { value: description, set: setDescription } = descriptionDraft;
  const setLabels = pick.labels;
  // The emoji for labels new to the list, held until the item creates them.
  const labelEmoji = picked.labelEmoji;
  const setLabelEmoji = pick.labelEmoji;
  const setAssigneeIds = pick.assigneeIds;
  const setRepeat = pick.repeat;
  const [assignOpen, setAssignOpen] = useState(false);
  const [dueOpen, setDueOpen] = useState(false);
  // Worked out as it's used, so a dialog left open past the day's turnover
  // gives the next item the new day, not the one it opened on.
  const today = useToday();
  const initialDue: Due | null = dueToday && today ? { dueFrom: null, dueDate: today } : null;
  const setDue = (next: Due | null) => setPicked((cur) => ({ ...cur, due: next }));
  // The steps added so far, kept as drafts are (signing out drops them).
  const [subItems, setSubItems] = useStoredState("draft:new-item:sub-items", NO_SUB_ITEMS);
  const { value: subDraft, set: setSubDraft } = useDraft("new-item:sub-draft");
  // How many were added, so the same draft is asked about again.
  const [added, setAdded] = useState(0);
  // Whether anything was added in this session: Add & create more keeps the dialog
  // open so you can enter a run of items, so Cancel becomes Done.
  const [addedAny, setAddedAny] = useState(false);
  const [pending, start] = useTransition();
  // Which button the add in flight came from, for its "Adding…".
  const [addingAnother, setAddingAnother] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  // An item opened from here, such as the one it looks like it repeats,
  // slides in with a way back to the form, as the Brief's lists do; none
  // for the form.
  const trail = useItemTrail((id) => findItem(id) !== undefined);
  const shownItem = trail.id ? findItem(trail.id) : undefined;
  const subRef = useRef<HTMLInputElement>(null);
  // Each new step lands above the step input and pushes it down, out of view
  // once the dialog hits its max height, so scroll it back while typing.
  useLayoutEffect(() => {
    if (subRef.current === document.activeElement) {
      subRef.current?.scrollIntoView({ block: "nearest" });
    }
  }, [subItems.length]);
  // Bumped each time the dialog opens, so an add that finishes after the dialog
  // was closed (and maybe reopened) can't write into the new session's form.
  const session = useRef(0);
  useEffect(() => {
    if (open) session.current += 1;
  }, [open]);

  // Reset and seed the form every time the dialog opens — the project comes
  // from the caller (the centred column for ⌘N, or the chosen column's menu).
  // Adjusting state during render off a previous-value tracker is React's
  // recommended alternative to a reset-in-effect.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    // What's typed and picked was cleared when it last closed (close()),
    // so anything still there is a draft to carry on with.
    if (open) {
      setOpenedFrom(initialProjectId ?? "");
      setSuggested(null);
      setAssignOpen(false);
      setDueOpen(false);
      setAddedAny(false);
      trail.reset(null);
    }
  }

  const draft = { title: title.trim(), description: description.trim() };
  // An accepted parent holds its list for this item only, so the next item
  // in a run gets a fresh suggestion.
  const fixedProjectId = pickedProjectId || parent?.projectId || "";
  // `added` too: an add changes the list, so the same draft is asked again
  // (it may now be a duplicate of the item just added).
  const scope = JSON.stringify([fixedProjectId, added]);
  const context = JSON.stringify([draft, scope]);
  const suggestion =
    draft.title && suggested?.for === scope ? suggested.value : null;
  const fresh = Boolean(suggestion) && suggested?.draft === context;
  // What Jev fills in, until they clear its suggestions for this item.
  const prefill = picked.noSuggestions ? null : suggestion;
  // A suggested list counts only if it's one they can add to here.
  const suggestedList = projects.some((p) => p.id === prefill?.projectId)
    ? prefill?.projectId
    : null;
  // The parts of the title that set a field: Claude's, from its latest
  // answer, then the rules' (below, once the list's people are known). A
  // list named in the title beats the one it opened from, not one picked.
  const kept = picked.titleKept ?? NO_IDS;
  const dropped = picked.titleDropped ?? NO_IDS;
  const aiParts = (suggestion?.titleParts ?? NO_PARTS).filter((p) => !dropped.includes(partKey(p)));
  const listPart = placeParts(title, aiParts).find((p) => p.field === "list");
  const listPartId =
    listPart?.field === "list" && projects.some((pr) => pr.id === listPart.projectId)
      ? listPart.projectId
      : "";
  const projectId = picked.projectId || listPartId || fixedProjectId || suggestedList || "";
  const listFromTitle = !picked.projectId && Boolean(listPartId);
  const listSuggested = !fixedProjectId && !listPartId && Boolean(projectId);
  const project = projects.find((p) => p.id === projectId);
  // Sub-items go one level deep, so an item with its own checklist can't
  // go under a parent: neither offer one nor keep one while it has steps.
  const hasChecklist = subItems.length > 0 || Boolean(subDraft.trim());
  const chosenParent =
    !hasChecklist && parent?.projectId === projectId ? parent.item : null;
  // Hints about items on a list they can't add to are no use here.
  // Warnings about the draft are only for the draft they were made for.
  const hints = projectId && fresh ? suggestion : null;
  const duplicate =
    hints?.duplicate && hints.duplicate.id !== picked.duplicateIgnored ? hints.duplicate : null;
  const parentHint =
    !hasChecklist && !chosenParent && hints?.parent?.id !== hints?.duplicate?.id
      ? (hints?.parent ?? null)
      : null;
  // Each field is what was picked, else what the title says, else the
  // dialog's default, else Jev's suggestion, shown as one (`…Suggested`)
  // until it's picked. A suggestion about the list's labels or people is
  // only for the list it was asked about.
  const forThisList = prefill?.projectId === projectId ? prefill : null;
  const listLabels = useListLabels(projectId);
  // Only those who can edit the list can be assigned, so switching lists
  // drops anyone who can't edit the new one (and brings them back on return).
  const listAssignees = assigneesByProject[projectId] ?? NO_PEOPLE;
  const editors = listAssignees.filter((a) => a.canEdit);

  // The title's parts as the dialog shows them. One that disagrees with a
  // field already picked loses, and stays in the title so it's noticed. The
  // date a dialog opens with (a Brief's "+" opens on today) isn't a pick: a
  // date in the title beats it, as a list named there beats the one it
  // opened from.
  const placed = placeParts(title, [
    ...ruleParts(title, {
      people: editors.map((a) => ({ userId: a.userId, handle: a.displayUsername ?? a.username })),
      labels: listLabels.map((l) => l.name),
    }).filter((p) => !dropped.includes(partKey(p))),
    ...aiParts,
  ]);
  const shownParts: ShownPart[] = placed.flatMap((p): ShownPart[] => {
    let value = "";
    let clash = false;
    if (p.field === "due") {
      value = today ? dueLabel(p.due.dueDate, today, p.due.dueFrom) : p.due.dueDate;
      clash = picked.due !== undefined && !sameDue(picked.due, p.due);
    } else if (p.field === "repeat") {
      value = shortLabel(p.repeat);
      clash = picked.repeat !== undefined && !sameRepeat(picked.repeat, p.repeat);
    } else if (p.field === "who") {
      const person = editors.find((a) => a.userId === p.userId);
      if (!person) return [];
      value = assigneeName(person);
      clash = picked.assigneeIds !== undefined && !picked.assigneeIds.includes(p.userId);
    } else if (p.field === "label") {
      // Claude names labels of the list it was asked about, which may not be
      // this one; only a #label typed in the title makes a new one.
      if (!p.text.startsWith("#") && !listLabels.some((l) => l.name === p.label)) return [];
      value = p.label;
    } else if (p.field === "list") {
      const list = projects.find((pr) => pr.id === p.projectId);
      if (!list) return [];
      value = list.name;
      clash = Boolean(picked.projectId) && picked.projectId !== p.projectId;
    }
    const isKept = kept.includes(partKey(p));
    const shown = clash ? "clash" : p.remove && !isKept ? "out" : "stays";
    return [{ ...p, kept: isKept, value, shown }];
  });
  const agreeing = shownParts.filter((p) => p.shown !== "clash");
  const titleDue = agreeing.flatMap((p) => (p.field === "due" ? [p.due] : []))[0] ?? null;
  const titleRepeat = agreeing.flatMap((p) => (p.field === "repeat" ? [p.repeat] : []))[0] ?? null;
  const titleWho = [...new Set(agreeing.flatMap((p) => (p.field === "who" ? [p.userId] : [])))];
  const titleLabels = agreeing.flatMap((p) => (p.field === "label" ? [p.label] : []));
  // The title it adds as: without the parts taken out, and what joined them.
  const { saved, struck } = cutTitle(title, shownParts.filter((p) => p.shown === "out"));

  const suggestedDue = prefill?.due && today ? parseDue(prefill.due, today) : null;
  const dueFromTitle = picked.due === undefined && Boolean(titleDue);
  const dueSuggested = picked.due === undefined && !initialDue && !titleDue && Boolean(suggestedDue);
  const due = picked.due !== undefined ? picked.due : (titleDue ?? initialDue ?? suggestedDue);
  const repeatFromTitle = picked.repeat === undefined && Boolean(titleRepeat);
  const repeatSuggested = picked.repeat === undefined && !titleRepeat && Boolean(prefill?.repeat);
  const repeat =
    picked.repeat !== undefined ? picked.repeat : (titleRepeat ?? prefill?.repeat ?? null);
  const suggestedLabel = listLabels.find((l) => l.name === forThisList?.label)?.name;
  const labelsSuggested = picked.labels === undefined && Boolean(suggestedLabel);
  const baseLabels = picked.labels ?? (suggestedLabel ? [suggestedLabel] : NO_IDS);
  // A label in the title adds to the others; taking its chip off drops it.
  const labels = titleLabels.length ? [...new Set([...baseLabels, ...titleLabels])] : baseLabels;
  // On a list only they can edit, it's theirs to do unless they say not.
  const onlyMe = editors.length === 1 && editors[0].userId === viewerId;
  const suggestedAssignee = editors.find((a) => a.userId === forThisList?.assigneeId);
  const whoFromTitle = picked.assigneeIds === undefined && titleWho.length > 0;
  const assigneesSuggested =
    picked.assigneeIds === undefined && !onlyMe && !whoFromTitle && Boolean(suggestedAssignee);
  const assigneeIds =
    picked.assigneeIds ??
    (whoFromTitle
      ? titleWho
      : onlyMe
        ? [viewerId]
        : suggestedAssignee
          ? [suggestedAssignee.userId]
          : NO_IDS);
  const assigned = editors.filter((a) => assigneeIds.includes(a.userId));
  const canAssignSelf = editors.some((a) => a.userId === viewerId);
  const anySuggested =
    listSuggested || dueSuggested || repeatSuggested || labelsSuggested || assigneesSuggested;
  // A list Jev suggested for what was typed before waits for the answer
  // about what's typed now: it decides where the item goes.
  const canAdd = Boolean(title.trim()) && Boolean(projectId) && !pending && !(listSuggested && !fresh);
  // Keeping a part's words in the title, and stopping it setting its field.
  function keepPart(part: ShownPart) {
    const k = partKey(part);
    setPicked((cur) => {
      const ks = cur.titleKept ?? [];
      return { ...cur, titleKept: ks.includes(k) ? ks.filter((x) => x !== k) : [...ks, k] };
    });
  }
  function dropPart(part: ShownPart) {
    setPicked((cur) => ({ ...cur, titleDropped: [...(cur.titleDropped ?? []), partKey(part)] }));
  }
  // A, I and D as in the item dialog, A and I once a list is chosen.
  // They're ignored while typing in a field.
  const openPicker = useCallback(() => setAssignOpen(true), []);
  const toggleMe = () => setAssigneeIds(toggleAssignee(assigneeIds, viewerId));
  useItemShortcuts({
    active: open && !pending && !dueOpen && !shownItem,
    onOpenPicker: projectId ? openPicker : () => {},
    onAssignToMe: projectId && canAssignSelf ? toggleMe : undefined,
    onDue: () => setDueOpen(true),
  });

  // Create a list from the List field. Nobody chose its icon, so it gets
  // Jev's, as New list would give it.
  function createList(name: string) {
    start(async () => {
      await runAction(
        createProjectAction({ name, iconChosen: false }).then((created) =>
          setPickedProjectId(created.id),
        ),
        "create the list",
      );
    });
  }

  useEffect(() => {
    if (!open || !draft.title) return;
    // Newer typing gives up on the answer for this draft, and stops Jev's work on it.
    const stale = new AbortController();
    const timer = setTimeout(() => {
      // A suggestion that fails is just left out.
      aiRead(
        "newItem",
        { projectId: fixedProjectId || null, ...draft, today: today ?? null },
        stale.signal,
      ).then(
        (value) => {
          if (!stale.signal.aborted) setSuggested({ for: scope, draft: context, value });
        },
        // An answer that can't be had leaves nothing to stand in for it.
        () => {
          if (!stale.signal.aborted) setSuggested(null);
        },
      );
    }, SUGGEST_DELAY_MS);
    return () => {
      stale.abort();
      clearTimeout(timer);
    };
    // `context` covers the draft, the fixed list and the adds so far.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, context]);

  function addSubItem() {
    const t = subDraft.trim();
    if (!t) return;
    setSubItems((cur) => [...cur, t]);
    setSubDraft("");
  }

  /**
   * Adds the item, then closes the dialog, or with `another` keeps it open
   * for the next one. Enter and ⌘Enter add and close, as the main button.
   */
  function add(another: boolean) {
    // What's typed, and the title it adds as.
    const raw = title.trim();
    const t = saved;
    if (!canAdd) return;
    const d = description.trim() || null;
    // A suggestion for what was typed before is shown, but not added.
    const ls =
      labelsSuggested && !fresh ? labels.filter((l) => l !== suggestedLabel || titleLabels.includes(l)) : labels;
    const emoji = labelEmoji;
    const was = picked;
    const ids = assigneesSuggested && !fresh ? [] : assigned.map((a) => a.userId);
    const du = dueSuggested && !fresh ? null : due;
    const r = repeatSuggested && !fresh ? null : repeat;
    const p = chosenParent?.id ?? null;
    // A sub-item still in its input counts, so it isn't lost to the click.
    const subs = [...subItems, subDraft.trim()].filter(Boolean);
    const startedIn = session.current;
    const prefix = projects.find((pr) => pr.id === projectId)?.refPrefix;
    setAddingAnother(another);
    start(async () => {
      const added = await runAction(
        addItemAction({
          projectId,
          title: t,
          description: d,
          labels: ls,
          labelEmoji: emoji,
          parentId: p,
          assigneeIds: ids,
          dueDate: du?.dueDate ?? null,
          dueFrom: du?.dueFrom ?? null,
          repeat: r,
          subItems: subs,
        }).then((item) => {
          const shown = shownOnBoard(item, subs.length);
          // Confirms each add in a run, even one that lands after the dialog
          // closed, and says when the viewer's filters keep it off the board.
          toast.success(
            <AddedToast
              title={t}
              itemRef={formatItemRef(prefix ?? "", item.number)}
              onOpen={() => {
                toast.dismiss(item.id);
                onOpenItem(item);
              }}
            />,
            { id: item.id, description: shown ? undefined : "Hidden by your filters" },
          );
        }),
        `add “${t}”`,
      );
      // A failed add keeps the form as it was, to try again.
      if (!added || session.current !== startedIn) return;
      if (!another) {
        close();
        return;
      }
      // Stay open for the next item: clear what's per-item, keep the list
      // and labels, and put the cursor back in the title. You can type
      // the next item while this one saves (submitting waits; the button
      // shows "Adding…"), so only clear fields that still hold what was
      // submitted — never text typed for the next item.
      setTitle((cur) => (cur.trim() === raw ? "" : cur));
      setDescription((cur) => ((cur.trim() || null) === d ? "" : cur));
      // Assignees, a due date, repeat and parent belong to the item just
      // added, like its title, and so does clearing Jev's suggestions: the
      // next item starts from the defaults (the date it opened with) and
      // Jev's suggestions for it. Compared as JSON: each read from storage
      // is a new copy.
      const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
      setPicked((cur) => ({
        ...cur,
        assigneeIds: same(cur.assigneeIds, was.assigneeIds) ? undefined : cur.assigneeIds,
        due: same(cur.due, was.due) ? undefined : cur.due,
        repeat: same(cur.repeat, was.repeat) ? undefined : cur.repeat,
        parent: cur.parent?.item.id === p ? null : cur.parent,
        noSuggestions: undefined,
        titleKept: undefined,
        titleDropped: undefined,
        duplicateIgnored: undefined,
      }));
      // Sub-items can't be edited while it saves, so they're all this item's.
      setSubItems(NO_SUB_ITEMS);
      setSubDraft("");
      setAdded((n) => n + 1);
      setAddedAny(true);
      titleRef.current?.focus();
    });
  }

  /** Closes the dialog, dropping what's typed. */
  function close() {
    setTitle("");
    setDescription("");
    setSubItems(NO_SUB_ITEMS);
    setSubDraft("");
    setPicked(NOTHING_PICKED);
    onOpenChange(false);
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <ResponsiveDialogContent initialFocus={titleRef}>
        <ResponsiveDialogViews view={shownItem ? `item:${shownItem.id}` : "form"} direction={trail.direction}>
        {shownItem ? (
          renderItem(shownItem, {
            back: (
              <ResponsiveDialogBackButton
                label={(trail.previousId && findItem(trail.previousId)?.title) || "New item"}
                onClick={trail.back}
              />
            ),
            open,
            cameFrom: trail.direction === "back" ? trail.left : null,
            onOpenItem: (next) => trail.goTo(next.id),
            // Deleted or moved: back to the form.
            onClose: () => trail.reset(null),
          })
        ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            add(false);
          }}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="flex shrink-0 flex-col gap-2 border-b border-neutral-200 px-4 pt-3 pb-4 dark:border-neutral-800">
            <div className="flex min-w-0 items-center gap-1">
              <ResponsiveDialogTitle className="text-sm font-medium text-neutral-500">
                New item
              </ResponsiveDialogTitle>
              <ResponsiveDialogDescription className="sr-only">
                Create a new task in a list.
              </ResponsiveDialogDescription>
              <ResponsiveDialogCloseButton className="ml-auto" />
            </div>
            <TitleField
              inputRef={titleRef}
              title={title}
              onTitle={setTitle}
              parts={shownParts}
              saved={saved}
              struck={struck}
              onKeep={keepPart}
              onDrop={dropPart}
              disabled={pending}
            />
            {duplicate && (
              <div
                data-item-ref={duplicate.ref}
                className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5 rounded-lg bg-amber-500/12 px-2.5 py-1.5 text-xs text-amber-800 dark:text-amber-300"
              >
                {/* The whole sentence is the button: a button can't wrap
                    inline in text, so a long title would sit in a centred
                    block of its own. */}
                <button
                  type="button"
                  onClick={() => trail.goTo(duplicate.id)}
                  className="group flex min-w-0 flex-[1_1_12rem] items-start gap-2 text-left"
                >
                  <span className="mt-[5px] size-1.5 shrink-0 rounded-full bg-amber-500" />
                  <span className="min-w-0">
                    Looks like{" "}
                    <span className="font-medium underline decoration-amber-500/50 underline-offset-2 group-hover:decoration-current">
                      {duplicate.ref} “{duplicate.title}”
                    </span>{" "}
                    is already on this list.
                  </span>
                </button>
                <div className="ml-auto flex shrink-0 gap-1.5">
                  {/* Not the same task but a step of it: put it under it. */}
                  {duplicate.topLevel && !hasChecklist && (
                    <PartButton
                      disabled={pending}
                      onClick={() =>
                        setPicked((cur) => ({
                          ...cur,
                          parent: { projectId, item: duplicate },
                          duplicateIgnored: duplicate.id,
                        }))
                      }
                    >
                      <IndentIncrease className="size-3.5" />
                      Add as sub-item
                    </PartButton>
                  )}
                  <PartButton
                    disabled={pending}
                    onClick={() => setPicked((cur) => ({ ...cur, duplicateIgnored: duplicate.id }))}
                  >
                    <X className="size-3.5" />
                    Ignore
                  </PartButton>
                </div>
              </div>
            )}
            {/* Unstyled, like the title above; no one to mention. */}
            <MentionTextarea
              people={NO_PEOPLE}
              draft={descriptionDraft}
              placeholder="Add description…"
              aria-label="Description"
              disabled={pending}
              rows={1}
              className="field-sizing-content max-h-48 w-full resize-none bg-transparent text-sm text-neutral-600 outline-none placeholder:text-muted-foreground disabled:opacity-50 dark:text-neutral-300"
            />
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              {/* First, and marked until chosen: nothing can be added without it. */}
              <CreatableCombobox
                options={projects.map((p) => ({ value: p.id, label: p.name }))}
                value={projectId}
                onChange={setPickedProjectId}
                onCreate={createList}
                placeholder="Find or create a list…"
                title={listSuggested ? "List (suggested by Jev)" : "List"}
                disabled={pending}
                className={
                  !project
                    ? cn(
                        EMPTY_CHIP,
                        "border-blue-500 text-blue-700 hover:text-blue-800 dark:border-blue-400/70 dark:text-blue-300 dark:hover:text-blue-200 [&_svg]:text-current",
                      )
                    : listSuggested
                      ? SUGGESTED_CHIP
                      : listFromTitle
                        ? cn(CHIP, PART_TONE.list.chip)
                        : CHIP
                }
              >
                {project ? (
                  <>
                    <ProjectIcon
                      icon={project.icon}
                      homepageUrl={project.homepageUrl}
                      name={project.name}
                      size={16}
                    />
                    <span className="min-w-0 truncate">{project.name}</span>
                  </>
                ) : (
                  <>
                    <List />
                    <span data-replay-safe>Choose a list</span>
                  </>
                )}
              </CreatableCombobox>
              <DueChip
                due={due}
                suggested={dueSuggested}
                tone={dueFromTitle ? PART_TONE.due.chip : undefined}
                done={false}
                disabled={pending}
                onChange={setDue}
                open={dueOpen}
                setOpen={setDueOpen}
              />
              <RepeatChip
                repeat={repeat}
                suggested={repeatSuggested}
                tone={repeatFromTitle ? PART_TONE.repeat.chip : undefined}
                completedAt={null}
                disabled={pending}
                onChange={setRepeat}
              />
              <AssigneeChip
                assigned={assigned}
                suggested={assigneesSuggested}
                tone={whoFromTitle ? PART_TONE.who.chip : undefined}
                disabled={pending || !projectId}
                open={assignOpen}
                setOpen={(next) => setAssignOpen(next && Boolean(projectId))}
              >
                <AssigneeOptions
                  selected={assigned.map((a) => a.userId)}
                  assignees={listAssignees}
                  viewerId={viewerId}
                  // Ticking sets this list's people only; keep anyone
                  // picked on another list for when you switch back.
                  // Unassigned clears everyone.
                  onChange={(ids) =>
                    setAssigneeIds((cur = NO_IDS) => [
                      ...cur.filter((id) => !listAssignees.some((a) => a.userId === id)),
                      ...ids,
                    ])
                  }
                  onClear={() => setAssigneeIds([])}
                />
              </AssigneeChip>
              {/* A new label is created with the item that uses it. */}
              <LabelChips
                projectId={projectId}
                value={labels}
                suggested={labelsSuggested}
                onChange={(names, added) => {
                  // A label from the title taken off stops the title setting it.
                  const off = shownParts.filter(
                    (p) => p.field === "label" && labels.includes(p.label) && !names.includes(p.label),
                  );
                  // Labels only the title sets stay the title's, not picks.
                  const onlyTitle = titleLabels.filter((l) => !baseLabels.includes(l));
                  setPicked((cur) => ({
                    ...cur,
                    labels: names.filter((n) => !onlyTitle.includes(n)),
                    titleDropped: off.length
                      ? [...(cur.titleDropped ?? []), ...off.map(partKey)]
                      : cur.titleDropped,
                  }));
                  const emoji = added?.emoji;
                  if (added && emoji) {
                    setLabelEmoji((cur) => ({ ...cur, [added.name]: emoji }));
                  }
                }}
                draftEmoji={labelEmoji}
                // The label is renamed on the server; keep this item's name for it in step.
                onRenamed={(from, to) =>
                  setLabels((cur = baseLabels) => cur.map((n) => (n === from ? to : n)))
                }
                onDraftEmoji={(name, emoji) =>
                  setLabelEmoji((cur) => ({ ...cur, [name]: { emoji, chosen: true } }))
                }
                disabled={pending}
                chipClassName={labels.length ? `${EMPTY_CHIP} px-2` : EMPTY_CHIP}
              />
              {/* Jev's parent hint fills the dashed Parent chip; accepting it sets it. */}
              {chosenParent ? (
                <span
                  data-item-ref={chosenParent.ref}
                  title={`Sub-item of ${chosenParent.ref}`}
                  className={`${CHIP} pr-1`}
                >
                  <IndentIncrease />
                  <span className="max-w-48 truncate">{chosenParent.title}</span>
                  <button
                    type="button"
                    aria-label="Don't add as a sub-item"
                    onClick={() => setParent(null)}
                    className="shrink-0 rounded-full p-0.5 hover:bg-neutral-200 dark:hover:bg-neutral-700"
                  >
                    <X />
                  </button>
                </span>
              ) : (
                parentHint && (
                  <button
                    type="button"
                    onClick={() => setParent({ projectId, item: parentHint })}
                    data-item-ref={parentHint.ref}
                    title={`Add under ${parentHint.ref} “${parentHint.title}”`}
                    className={EMPTY_CHIP}
                  >
                    <IndentIncrease />
                    <span className="max-w-56 truncate">
                      Add under “{parentHint.title}”?
                    </span>
                  </button>
                )
              )}
              {/* Fields picked stay as they are; the rest go back to empty. */}
              {anySuggested && (
                <button
                  type="button"
                  onClick={() => setPicked((cur) => ({ ...cur, noSuggestions: true }))}
                  disabled={pending}
                  className={cn(CHIP, "border-transparent text-muted-foreground hover:text-foreground")}
                >
                  <X />
                  <span>Clear suggestions</span>
                </button>
              )}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">
            <Field label="Checklist">
              <div className="space-y-1">
                {subItems.map((sub, i) => (
                  <div key={i} className="flex items-center gap-2 pl-2.5">
                    <span className="min-w-0 flex-1 truncate text-sm">{sub}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      disabled={pending}
                      onClick={() => {
                        setSubItems((cur) => cur.filter((_, j) => j !== i));
                        // The button unmounts, so keep focus in the checklist.
                        subRef.current?.focus();
                      }}
                      aria-label={`Remove sub-item ${sub}`}
                      className="text-neutral-400"
                    >
                      <X />
                    </Button>
                  </div>
                ))}
                <Input
                  ref={subRef}
                  value={subDraft}
                  onChange={(e) => setSubDraft(e.target.value)}
                  onKeyDown={(e) => {
                    // Enter adds the typed sub-item; on an empty input it
                    // submits the form as usual.
                    if (e.key === "Enter" && !e.nativeEvent.isComposing && subDraft.trim()) {
                      e.preventDefault();
                      addSubItem();
                    }
                  }}
                  placeholder={subItems.length ? "Add another…" : "Add a step…"}
                  disabled={pending}
                  className="text-sm"
                  aria-label="Add a sub-item"
                />
              </div>
            </Field>
          </div>

          <div className="flex shrink-0 items-center justify-end gap-2 border-t border-neutral-200 px-4 py-3 dark:border-neutral-800">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={close}
            >
              {addedAny ? "Done" : "Cancel"}
            </Button>
            {/* type="button", so Enter in a field presses Add item, not this. */}
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => add(true)}
              disabled={!canAdd}
            >
              <ListPlus data-icon="inline-start" />
              {pending && addingAnother ? "Adding…" : "Add & create more"}
            </Button>
            <Button type="submit" size="sm" disabled={!canAdd}>
              <Plus data-icon="inline-start" />
              {pending && !addingAnother ? "Adding…" : "Add item"}
            </Button>
          </div>
        </form>
        )}
        </ResponsiveDialogViews>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
