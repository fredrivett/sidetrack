"use client";

import { CircleCheck, History, SquareKanban, Sunrise } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import type { Greeting } from "@/core/agendaGreeting";
import type { AuditEntryWithActor } from "@/core/audit";
import type { FeedComment } from "@/core/comments";
import type { Part } from "@/core/describe";
import type { AssigneeView } from "@/core/members";
import type { AgentSession, AuditAction, Item, Label } from "@/core/schema";
import { type AgendaSaves, AgendaSavesContext } from "@/components/agenda-saves";
import { helloNow } from "@/components/AgendaGreeting";
import { AgendaView } from "@/components/AgendaView";
import { AgentSessionsProvider } from "@/components/agent-sessions";
import { AuditDialog } from "@/components/AuditDialog";
import { BoardHeader, BoardRail, HeaderRule, ColumnCard } from "@/components/BoardLayout";
import { cn } from "@/lib/utils";
import { DoneView } from "@/components/DoneView";
import { FilterMenu } from "@/components/FilterMenu";
import { type ItemSaves, ItemSavesContext } from "@/components/item-saves";
import { BoardDrag } from "@/components/BoardDrag";
import { DraggableItemList, moveItem } from "@/components/ItemList";
import { LabelsContext } from "@/components/Labels";
import { ProjectIcon } from "@/components/ProjectIcon";
import { SpaceTray } from "@/components/SpaceTray";
import { buttonVariants } from "@/components/ui/button";
import { useCollapsedItems } from "@/components/use-collapsed-items";
import { useToday } from "@/components/use-day-start";
import {
  applyItemChange,
  type ItemChanges,
  ItemChangesContext,
} from "@/components/use-optimistic-items";
import { UserMenu } from "@/components/UserMenu";
import { type ItemFilters, matchesFilters, NO_FILTERS, shownInGroups } from "@/lib/filters";
import { nestItems } from "@/lib/itemTree";
import { addDays, weekday, weekSpan } from "@/lib/time";

// The landing page's board: the app's own Brief, Board, Done, Activity and
// account menu, on made-up lists kept in this component's state. It opens on
// the Brief, whose greeting is written here from the lists (previewGreeting),
// so it keeps up as they change. Ticking, assigning, due dates, dragging and
// folding checklists and sections all work, through local versions of the
// board's saves (ItemChangesContext, ItemSavesContext, AgendaSavesContext),
// and Activity logs them under a made-up history (demoLog); nothing is sent
// anywhere, and a reload starts it over. What needs an account, such as an
// item's dialog (which loads from the server) or settings, asks the visitor
// to sign up instead, in a toast.

const noop = () => {};

const person = (userId: string, name: string, image: string | null = null): AssigneeView => ({
  userId,
  username: userId,
  displayUsername: userId,
  name,
  email: null,
  image,
  isOwner: userId === VIEWER,
  canEdit: true,
});

const VIEWER = "fredrivett";
const FRED = person(VIEWER, "Fred Rivett", "https://github.com/fredrivett.png?size=96");
const SAM = person("sam", "Sam");
const JO = person("jo", "Jo");

type PreviewList = {
  id: string;
  name: string;
  prefix: string;
  icon: string;
  assignees: AssigneeView[];
};

// Each list's labels with their emoji, which the rows read from LabelsContext.
const LABELS: Record<string, Label[]> = Object.fromEntries(
  Object.entries({
    lch: { Marketing: "✍️", Bug: "🐛", Infra: "⚙️" },
    cho: { Garden: "🌱", Cleaning: "🧽" },
    fix: { Heating: "🔥", Plumbing: "💧", Roof: "🏠" },
  }).map(([projectId, byName]) => [
    projectId,
    Object.entries(byName).map(([name, emoji]) => ({
      id: `${projectId}-${name}`,
      projectId,
      name,
      emoji,
      emojiChosen: true,
      archivedAt: null,
    })),
  ]),
);

const PERSONAL: PreviewList[] = [
  { id: "lch", name: "Launch", prefix: "LCH", icon: "🚀", assignees: [FRED] },
];
const HOME: PreviewList[] = [
  { id: "cho", name: "Chores", prefix: "CHO", icon: "🧺", assignees: [FRED, SAM, JO] },
  { id: "fix", name: "Fixes", prefix: "FIX", icon: "🔧", assignees: [FRED, SAM, JO] },
];

/**
 * The lists' items and agents, dated from the server's `today` and `now` so
 * the server render and the browser's agree.
 */
function demo(today: string, now: number) {
  const items: Item[] = [];
  const add = (
    projectId: string,
    number: number,
    title: string,
    extra: Partial<Item> = {},
  ) => {
    const it: Item = {
      id: `${projectId}-${number}`,
      projectId,
      title,
      description: null,
      labels: [],
      assigneeIds: [],
      createdBy: null,
      parentId: null,
      position: String(items.length).padStart(3, "0"),
      collapsed: false,
      number,
      dueDate: null,
      dueFrom: null,
      repeatEvery: null,
      repeatUnit: null,
      repeatOn: null,
      repeatDay: null,
      smartRule: null,
      smartLead: null,
      completedAt: null,
      createdAt: now,
      ...extra,
    };
    items.push(it);
    return it.id;
  };
  const hoursAgo = (h: number) => now - h * 3_600_000;
  const thisWeek = weekSpan(today, 0, "week");

  // Today's one thing, and one already done today.
  add("lch", 7, "Write the launch post", {
    labels: ["Marketing"],
    assigneeIds: [VIEWER],
    dueDate: today,
  });
  // Tomorrow's, which wants a head start today.
  add("lch", 13, "Email the waitlist", {
    labels: ["Marketing"],
    assigneeIds: [VIEWER],
    dueDate: addDays(today, 1),
  });
  add("lch", 11, "Set up a waitlist", {
    labels: ["Infra"],
    assigneeIds: [VIEWER],
    dueDate: today,
    completedAt: hoursAgo(1),
  });
  const demoVideo = add("lch", 9, "Record the demo video", {
    labels: ["Marketing"],
    assigneeIds: [VIEWER],
    dueDate: addDays(today, 3),
  });
  add("lch", 10, "Write the script", { parentId: demoVideo, completedAt: hoursAgo(20) });
  add("lch", 15, "Record the screen", { parentId: demoVideo });
  add("lch", 16, "Edit and add captions", { parentId: demoVideo });
  add("lch", 12, "Fix signup email going to spam", {
    labels: ["Bug", "Infra"],
    assigneeIds: [VIEWER],
  });
  add("lch", 14, "Submit to Product Hunt", { labels: ["Marketing"], ...thisWeek });

  add("cho", 3, "Water the plants", {
    assigneeIds: ["jo"],
    labels: ["Garden"],
    dueDate: today,
    repeatEvery: 1,
    repeatUnit: "week",
    completedAt: hoursAgo(3),
  });
  add("cho", 5, "Take the bins out", {
    assigneeIds: ["sam"],
    dueDate: addDays(today, 1),
    repeatEvery: 1,
    repeatUnit: "week",
  });
  add("cho", 7, "Deep clean the oven", {
    assigneeIds: [VIEWER, "sam"],
    labels: ["Cleaning"],
  });
  add("cho", 2, "Descale the coffee machine", {
    assigneeIds: [VIEWER],
    labels: ["Cleaning"],
    repeatEvery: 1,
    repeatUnit: "month",
    completedAt: hoursAgo(2),
  });

  add("fix", 4, "Book the boiler service", {
    assigneeIds: [VIEWER],
    labels: ["Heating"],
    dueDate: addDays(today, -2),
  });
  // Folded, to leave room for the roof's checklist below.
  const tap = add("fix", 6, "Fix the dripping tap", {
    assigneeIds: ["sam"],
    labels: ["Plumbing"],
    collapsed: true,
  });
  add("fix", 8, "Buy washers", { parentId: tap, completedAt: hoursAgo(26) });
  add("fix", 9, "Turn the water off", { parentId: tap });
  add("fix", 10, "Swap the washer", { parentId: tap });
  // A person and an agent on one item, its sub-items split between them.
  const roof = add("fix", 11, "Get three quotes for the roof", {
    assigneeIds: [VIEWER],
    labels: ["Roof"],
  });
  add("fix", 12, "Email the roofers", { parentId: roof });
  add("fix", 13, "Check the loft for the leak", { parentId: roof, assigneeIds: [VIEWER] });
  add("fix", 14, "Pick a roofer", { parentId: roof, assigneeIds: [VIEWER, "sam"] });

  // One agent working now, one gone quiet (idle after 15 minutes), and one
  // on the house's roof, both on the item and on its own sub-item.
  const sessions = [
    agentSession("lch-12", "Amp", now - 60_000),
    agentSession("lch-14", "Claude", hoursAgo(2)),
    agentSession("fix-11", "Claude", now - 4 * 60_000),
    agentSession("fix-12", "Claude", now - 4 * 60_000),
  ];
  return { items, sessions };
}

/** A run of an Activity row; an item's carries its id, to strike it once done. */
type LogPart = Part & { itemId?: string };

/** An Activity row, without the actor's name and face, which come from PEOPLE. */
type LogEntry = {
  id: string;
  ts: number;
  actor: string;
  /** The agent that made it, on the actor's behalf. */
  agent: string | null;
  action: AuditAction;
  projectId: string;
  parts: LogPart[];
};

const said = (text: string): LogPart => ({ text });
const named = (item: Pick<Item, "id" | "title">): LogPart => ({
  text: item.title,
  em: "item",
  quote: true,
  itemId: item.id,
});
const who = (name: string): LogPart => ({ text: name, em: "person" });
const due = (dueDate: string): LogPart => ({ text: dueDate, due: { dueDate, dueFrom: null } });

/**
 * What happened on the lists before the visitor arrived, newest first, as
 * Activity would show it, and the comments on their items.
 */
function demoLog(items: Item[], today: string, now: number) {
  const it = (id: string) => items.find((i) => i.id === id) as Item;
  const ago = (minutes: number) => now - minutes * 60_000;
  const entry = (
    minutes: number,
    actor: string,
    action: AuditAction,
    id: string,
    parts: LogPart[],
    agent: string | null = null,
  ): LogEntry => ({
    id: `demo-${minutes}-${id}`,
    ts: ago(minutes),
    actor,
    agent,
    action,
    projectId: it(id).projectId,
    parts,
  });
  const log: LogEntry[] = [
    entry(1, VIEWER, "start", "lch-12", [said("started work on "), named(it("lch-12"))], "Amp"),
    entry(4, VIEWER, "report", "fix-12", [
      said("reported on "),
      named(it("fix-12")),
      said(": two of the three roofers have quoted"),
    ], "Claude"),
    entry(10, VIEWER, "create", "fix-11", [said("commented on "), named(it("fix-11"))], "Claude"),
    entry(60, VIEWER, "complete", "lch-11", [said("completed "), named(it("lch-11"))]),
    entry(90, VIEWER, "start", "fix-11", [said("started work on "), named(it("fix-11"))], "Claude"),
    entry(120, VIEWER, "complete", "cho-2", [said("completed "), named(it("cho-2"))]),
    entry(121, VIEWER, "start", "lch-14", [said("started work on "), named(it("lch-14"))], "Claude"),
    entry(180, "jo", "complete", "cho-3", [said("completed "), named(it("cho-3"))]),
    entry(20 * 60, VIEWER, "complete", "lch-10", [said("completed "), named(it("lch-10"))]),
    entry(22 * 60, VIEWER, "update", "fix-4", [
      said("updated "),
      named(it("fix-4")),
      said(": due "),
      due(addDays(today, -2)),
    ]),
    entry(26 * 60, "sam", "complete", "fix-8", [said("completed "), named(it("fix-8"))]),
    entry(30 * 60, VIEWER, "create", "fix-11", [
      said("added task "),
      named(it("fix-11")),
      said(", assigned to "),
      who(FRED.name ?? ""),
    ]),
  ];
  const comment = (
    minutes: number,
    author: AssigneeView,
    id: string,
    body: string,
    agentName: string | null = null,
  ): FeedComment => {
    const { title, number, projectId, completedAt } = it(id);
    return {
      id: `comment-${id}-${minutes}`,
      itemId: id,
      userId: author.userId,
      agentKeyId: agentName?.toLowerCase() ?? null,
      agentName,
      body,
      createdAt: ago(minutes),
      editedAt: null,
      author,
      item: { id, title, number, projectId, completedAt },
    };
  };
  const comments = [
    comment(
      10,
      FRED,
      "fix-11",
      "Two quotes in so far: £4,200 from Hadley & Sons and £4,850 from TopRoof. Chasing the third, then I'll compare all three here.",
      "Claude",
    ),
    comment(170, JO, "cho-3", "The fern by the window was bone dry. Might be worth moving it out of the sun."),
    comment(25 * 60, SAM, "fix-6", "Got the washers. I'll do it on Saturday once the water's off."),
  ];
  return { log, comments };
}

/** The viewer's agents, which the assignee pickers offer to start. */
const AGENTS = [
  { keyId: "amp", name: "Amp" },
  { keyId: "claude", name: "Claude" },
];
const ALL_LISTS = [...PERSONAL, ...HOME].map((l) => l.id);
// The lists as the Brief, Done and Activity read them.
const LISTS = [...PERSONAL, ...HOME].map((l) => ({
  id: l.id,
  name: l.name,
  icon: l.icon,
  homepageUrl: null,
  prefix: l.prefix,
  refPrefix: l.prefix,
}));
const assigneesByProject = Object.fromEntries([...PERSONAL, ...HOME].map((l) => [l.id, l.assignees]));
// The Filter menu's choices: everyone and every label on the lists.
const PEOPLE = [FRED, JO, SAM];
const LABEL_CHOICES = Object.values(LABELS)
  .flat()
  .sort((a, b) => a.name.localeCompare(b.name));

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * The Brief's greeting for the sample lists as they stand now, as the
 * built-in templates would put it: what's on today, what slipped, what's
 * tomorrow and what the agents have in hand, from the viewer's own open
 * items. Written again as the visitor ticks, reassigns or redates, so it
 * never names something already done.
 */
function previewGreeting(items: Item[], sessions: AgentSession[], today: string): Greeting {
  const mine = items.filter(
    (i) => i.parentId === null && i.completedAt === null && i.assigneeIds.includes(VIEWER),
  );
  const titles: Record<string, string> = {};
  const item = (i: Item) => {
    titles[i.id] = i.title;
    return `{{item:${i.id}}}`;
  };
  // The first two, by name: "A", or "A and B".
  const two = (list: Item[]) => list.slice(0, 2).map(item).join(" and ");
  const sentences: string[] = [];
  const dueToday = mine.filter((i) => i.dueDate === today && !i.dueFrom);
  if (dueToday.length === 1) sentences.push(`${two(dueToday)} is the one for today.`);
  else if (dueToday.length > 1) sentences.push(`${two(dueToday)} are on for today.`);
  const late = mine.filter((i) => i.dueDate !== null && i.dueDate < today);
  if (late.length > 0) {
    sentences.push(
      `${two(late)} slipped past ${late.length === 1 ? "its day" : "their days"}, so ${
        sentences.length ? "fit it in if you can" : "that's a good place to start"
      }.`,
    );
  }
  const tomorrow = mine.filter((i) => i.dueDate === addDays(today, 1) && !i.dueFrom);
  if (tomorrow.length > 0) {
    sentences.push(
      `${two(tomorrow)} ${tomorrow.length === 1 ? "is" : "are"} due tomorrow, so worth a head start today.`,
    );
  }
  const agents = mine.flatMap((i) => {
    const s = sessions.find((s) => s.itemId === i.id && s.finishedAt === null);
    return s ? [`${s.agentName} is on ${item(i)}`] : [];
  });
  if (agents.length > 0) sentences.push(`${agents.slice(0, 2).join(", and ")}.`);
  if (sentences.length === 0) {
    sentences.push(`Nothing pressing. Enjoy the rest of your ${WEEKDAYS[weekday(today)]}.`);
  }
  return {
    hello: helloNow("Fred"),
    text: sentences.join(" "),
    titles,
    others: [],
    written: false,
  };
}

/** One of the viewer's agents at work on an item, last heard from then. */
function agentSession(itemId: string, agentName: string, lastActiveAt: number): AgentSession {
  return {
    id: `${agentName}-${itemId}-${lastActiveAt}`,
    itemId,
    userId: VIEWER,
    agentKeyId: agentName.toLowerCase(),
    agentName,
    threadUrl: null,
    branch: "",
    note: null,
    startedAt: lastActiveAt,
    lastActiveAt,
    finishedAt: null,
  };
}

export function PreviewBoard({
  today,
  now,
  signUp,
}: {
  today: string;
  now: number;
  /** Where the page's call to action goes, which the toast offers. */
  signUp: { href: string; label: string; nudge: string };
}) {
  const router = useRouter();
  const [initial] = useState(() => {
    const board = demo(today, now);
    return { ...board, ...demoLog(board.items, today, now) };
  });
  const [items, setItems] = useState(initial.items);
  const [sessions, setSessions] = useState(initial.sessions);
  const [log, setLog] = useState(initial.log);
  const [collapsedTrays, setCollapsedTrays] = useState<ReadonlySet<string>>(new Set());
  const [filters, setFilters] = useState(NO_FILTERS);
  const [view, setView] = useState<"brief" | "board" | "done">("brief");
  const [activityOpen, setActivityOpen] = useState(false);

  // What needs an account (an item's dialog, settings) asks for one instead.
  // One at a time, however often it's asked.
  const askToSignUp = () =>
    toast("That needs a board of your own", {
      id: "preview-sign-up",
      description: signUp.nudge,
      action: { label: signUp.label, onClick: () => router.push(signUp.href) },
    });
  // The Brief's folds, kept here as the board keeps them on the account.
  const [folds, setFolds] = useState({
    overdue: false,
    noDate: false,
    lists: [] as string[],
  });

  // Finished work needs no agent, as on the server: completing an item ends
  // the sessions on it, and on the sub-items and parent it completes with it.
  // Adjusted while rendering, so a finished row never shows an agent at work.
  const doneAt = new Map(items.map((i) => [i.id, i.completedAt]));
  const finished = sessions.map((s) => ({
    ...s,
    finishedAt: s.finishedAt ?? doneAt.get(s.itemId) ?? null,
  }));
  if (finished.some((s, i) => s.finishedAt !== sessions[i].finishedAt)) setSessions(finished);

  // The board's saves, applied here instead of on the server, and logged as
  // the visitor's own changes, for Activity. Made afresh each render, so the
  // log reads the items as they are now.
  const record = (
    action: AuditAction,
    projectId: string,
    parts: LogPart[],
    agent: string | null = null,
  ) =>
    setLog((had) => [
      { id: `visitor-${had.length}`, ts: Date.now(), actor: VIEWER, agent, action, projectId, parts },
      ...had,
    ]);
  const itemOf = (id: string) => items.find((i) => i.id === id);
  const nest = (item: Item, parentId: string | null) => {
    const parent = itemOf(parentId ?? item.parentId ?? "");
    if (!parent || parentId === item.parentId) return;
    record(
      "update",
      item.projectId,
      parentId
        ? [said("made "), named(item), said(" a sub-item of "), named(parent)]
        : [said("moved "), named(item), said(" out of "), named(parent)],
    );
  };
  const changes: ItemChanges = {
    setCompleted: (item, done) => {
      setItems((list) => applyItemChange(list, { kind: "complete", item, done, at: Date.now() }));
      record(done ? "complete" : "uncomplete", item.projectId, [
        said(done ? "completed " : "reopened "),
        named(item),
      ]);
    },
    deleteItem: (item) => {
      setItems((list) => applyItemChange(list, { kind: "delete", item }));
      record("delete", item.projectId, [said("deleted "), named(item)]);
    },
    setParent: (item, parentId) => {
      setItems((list) => applyItemChange(list, { kind: "parent", item, parentId }));
      nest(item, parentId);
    },
  };
  const saves: ItemSaves = (() => {
    const nameOf = (id: string) =>
      PEOPLE.find((p) => p.userId === id)?.name ?? AGENTS.find((a) => a.keyId === id)?.name ?? id;
    const people = (ids: string[]) => ids.flatMap((id, n) => [...(n ? [said(", ")] : []), who(nameOf(id))]);
    // Within the item's own list: a drop's top and end are that list's.
    const move = (id: string, parentId: string | null | undefined, position: string) =>
      setItems((list) => {
        const projectId = list.find((i) => i.id === id)?.projectId;
        const parent = parentId === undefined ? list.find((i) => i.id === id)?.parentId : parentId;
        const own = list.filter((i) => i.projectId === projectId);
        return [
          ...list.filter((i) => i.projectId !== projectId),
          ...moveItem(own, id, { parentId: parent ?? null, position }),
        ];
      });
    const update = (i: Item, patch: Parameters<ItemSaves["updateItem"]>[1]) => {
      const next = { ...i };
      if ("dueDate" in patch) {
        next.dueDate = patch.dueDate ?? null;
        next.dueFrom = patch.dueFrom ?? null;
      }
      const add = patch.addAssigneeIds ?? [];
      const remove = patch.removeAssigneeIds ?? [];
      next.assigneeIds = [
        ...(patch.assigneeIds ?? i.assigneeIds).filter((a) => !remove.includes(a)),
        ...add.filter((a) => !i.assigneeIds.includes(a)),
      ];
      return next;
    };
    return {
      updateItem: async (id, patch) => {
        setItems((list) => list.map((i) => (i.id === id ? update(i, patch) : i)));
        const before = itemOf(id);
        if (!before) return;
        const after = update(before, patch);
        const added = after.assigneeIds.filter((a) => !before.assigneeIds.includes(a));
        const removed = before.assigneeIds.filter((a) => !after.assigneeIds.includes(a));
        const changed: LogPart[][] = [];
        if (after.dueDate !== before.dueDate || after.dueFrom !== before.dueFrom) {
          changed.push(
            after.dueDate
              ? [
                  said("due "),
                  {
                    text: after.dueFrom ? `${after.dueFrom} to ${after.dueDate}` : after.dueDate,
                    due: { dueDate: after.dueDate, dueFrom: after.dueFrom },
                  },
                ]
              : [said("due date cleared")],
          );
        }
        if (added.length) changed.push([said("assigned "), ...people(added)]);
        if (removed.length) changed.push([said("unassigned "), ...people(removed)]);
        if (changed.length === 0) return;
        record("update", before.projectId, [
          said("updated "),
          named(before),
          said(": "),
          ...changed.flatMap((p, n) => (n ? [said(", "), ...p] : p)),
        ]);
      },
      reorderItem: async (id, position) => {
        move(id, undefined, position);
        const item = itemOf(id);
        if (item) record("reorder", item.projectId, [said("reordered "), named(item)]);
      },
      setItemParent: async (id, parentId, position) => {
        if (position) move(id, parentId, position);
        else {
          setItems((list) => {
            const item = list.find((i) => i.id === id);
            return item ? applyItemChange(list, { kind: "parent", item, parentId }) : list;
          });
        }
        const item = itemOf(id);
        if (item) nest(item, parentId);
      },
      setItemsCollapsed: async (ids, collapsed) =>
        setItems((list) => list.map((i) => (ids.includes(i.id) ? { ...i, collapsed } : i))),
      startAgent: async (itemId, keyId) => {
        const name = nameOf(keyId);
        setSessions((list) => [...list, agentSession(itemId, name, Date.now())]);
        const item = itemOf(itemId);
        if (item) {
          record("start", item.projectId, [said("asked "), who(name), said(" to work on "), named(item)]);
        }
      },
      stopAgent: async (itemId, keyId) => {
        setSessions((list) =>
          list.map((s) =>
            s.itemId === itemId && s.agentKeyId === keyId && s.finishedAt === null
              ? { ...s, finishedAt: Date.now() }
              : s,
          ),
        );
        const item = itemOf(itemId);
        if (item) {
          record("finish", item.projectId, [said("stopped "), who(nameOf(keyId)), said(" on "), named(item)]);
        }
      },
    };
  })();

  const agendaSaves = useMemo<AgendaSaves>(
    () => ({
      setOverdueCollapsed: async (overdue) => setFolds((f) => ({ ...f, overdue })),
      setNoDateCollapsed: async (noDate) => setFolds((f) => ({ ...f, noDate })),
      setNoDateListFolded: async (id, folded) =>
        setFolds((f) => ({
          ...f,
          lists: folded ? [...f.lists.filter((l) => l !== id), id] : f.lists.filter((l) => l !== id),
        })),
    }),
    [],
  );

  const itemsByProject = Object.fromEntries(
    ALL_LISTS.map((id) => [id, items.filter((i) => i.projectId === id)]),
  );
  // An Activity row as the dialog reads it: who made it, and its items struck
  // through once done.
  const logged = (e: LogEntry): AuditEntryWithActor => {
    const actor = PEOPLE.find((p) => p.userId === e.actor);
    const parts: Part[] = e.parts.map(({ itemId, ...part }) =>
      itemId && itemOf(itemId)?.completedAt ? { ...part, done: true } : part,
    );
    return {
      id: e.id,
      ts: e.ts,
      actor: e.actor,
      source: e.agent ? "mcp" : "web",
      action: e.action,
      entityType: "item",
      entityId: "",
      projectId: e.projectId,
      parentId: null,
      detail: parts.map((p) => p.text).join(""),
      event: null,
      agentKeyId: e.agent?.toLowerCase() ?? null,
      agentName: e.agent,
      parts,
      actorName: actor?.name ?? null,
      actorImage: actor?.image ?? null,
    };
  };

  const toggleTray = (id: string, collapsed: boolean) =>
    setCollapsedTrays((trays) => {
      const next = new Set(trays);
      if (collapsed) next.add(id);
      else next.delete(id);
      return next;
    });

  const trays = [
    { id: "personal", name: "Personal", icon: null, color: null, lists: PERSONAL },
    { id: "home", name: "Home", icon: "🏡", color: "sage" as const, lists: HOME },
  ];

  return (
    <ItemChangesContext value={changes}>
      <ItemSavesContext value={saves}>
        <LabelsContext value={LABELS}>
        <BoardDrag groups={null}>
        <AgentSessionsProvider
          sessions={sessions}
          viewerId={VIEWER}
          startable={AGENTS}
          startableIn={ALL_LISTS}
        >
          {/* On phones a column fills the frame, not the screen as on the
              board (SpaceTray's --column-width): the screen less the page's
              40px of padding, the frame's 2px border, the rail's 24px and the
              tray's 16px. */}
          <div className="flex h-[36rem] flex-col overflow-hidden rounded-2xl [&_section]:[--column-width:calc(100vw-82px)] border border-neutral-200 bg-neutral-50 text-left shadow-xl shadow-neutral-900/5 dark:border-neutral-800 dark:bg-neutral-950 dark:shadow-black/40">
            <BoardHeader
              nav={
                // The board's view switch (Kanban). The underline sits on the header's bottom border: 8px of
                // padding and the 1px border below the tabs, which stretch to
                // the header's height when its right side wraps to two rows.
                <div className="flex min-h-7 items-stretch self-stretch text-[13px] font-medium max-[360px]:text-xs touch:min-h-9 touch:text-sm touch:max-[360px]:text-xs">
                  {(
                    [
                      ["Brief", Sunrise],
                      ["Board", SquareKanban],
                      ["Done", CircleCheck],
                    ] as const
                  ).map(([label, Icon]) => {
                    const to = label.toLowerCase() as typeof view;
                    return (
                    <button
                      key={label}
                      type="button"
                      onClick={() => setView(to)}
                      aria-pressed={view === to}
                      className={`relative flex items-center gap-1.5 whitespace-nowrap rounded-md px-2 outline-none focus-visible:ring-2 focus-visible:ring-neutral-300 sm:px-2.5 [&_svg]:size-3.5 touch:[&_svg]:size-4 touch:max-sm:[&_svg]:size-5 ${
                        view === to
                          ? "text-neutral-900 after:absolute after:inset-x-0 after:-bottom-[9px] after:h-0.5 after:rounded-full after:bg-neutral-900 dark:text-neutral-100 dark:after:bg-neutral-100"
                          : "text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
                      }`}
                    >
                      <Icon aria-hidden />
                      <span
                        className={`max-sm:sr-only ${
                          label === "Brief" ? "font-display text-[18px] leading-none font-normal tracking-[-0.01em] italic" : ""
                        }`}
                      >
                        {label}
                      </span>
                    </button>
                    );
                  })}
                </div>
              }
            >
              <FilterMenu
                filters={filters}
                onChange={setFilters}
                people={PEOPLE}
                labels={LABEL_CHOICES}
                viewerId={VIEWER}
              />
              <button
                type="button"
                onClick={() => setActivityOpen(true)}
                className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "text-muted-foreground")}
              >
                <History />
                <span className="hidden sm:inline">Activity</span>
              </button>
              <HeaderRule />
              <UserMenu
                user={FRED}
                archivedCount={0}
                onShowArchived={askToSignUp}
                onShowActivity={() => setActivityOpen(true)}
                onInvite={askToSignUp}
                onTry={askToSignUp}
              />
            </BoardHeader>
            {view === "brief" ? (
              <AgendaSavesContext value={agendaSaves}>
                <AgendaView
                  projects={LISTS}
                  itemsByProject={itemsByProject}
                  assigneesByProject={assigneesByProject}
                  prLinksByItem={{}}
                  viewerId={VIEWER}
                  overdueCollapsed={folds.overdue}
                  noDateCollapsed={folds.noDate}
                  noDateFoldedLists={folds.lists}
                  greet
                  firstName="Fred"
                  filters={filters}
                  preview={{
                    greeting: previewGreeting(items, finished, today),
                    onOpenItem: askToSignUp,
                  }}
                />
              </AgendaSavesContext>
            ) : view === "done" ? (
              <DoneView
                projects={LISTS}
                itemsByProject={itemsByProject}
                assigneesByProject={assigneesByProject}
                prLinksByItem={{}}
                viewerId={VIEWER}
                filters={filters}
                // Everything finished is here: there's no more to load.
                since={0}
                more={false}
                loading={false}
                failed={false}
                onLoadMore={noop}
                onRetry={noop}
                onOpenItem={askToSignUp}
              />
            ) : (
            <BoardRail>
              {trays.map((tray) => (
                <SpaceTray
                  key={tray.id}
                  name={tray.name}
                  icon={tray.icon}
                  color={tray.color}
                  lists={tray.lists}
                  collapsed={collapsedTrays.has(tray.id)}
                  onToggle={() => toggleTray(tray.id, !collapsedTrays.has(tray.id))}
                  onOpenList={() => toggleTray(tray.id, false)}
                >
                  {tray.lists.map((list) => (
                    <PreviewColumn
                      key={list.id}
                      list={list}
                      items={items.filter((i) => i.projectId === list.id)}
                      filters={filters}
                      onOpenItem={askToSignUp}
                    />
                  ))}
                </SpaceTray>
              ))}
            </BoardRail>
            )}
          </div>
          <AuditDialog
            open={activityOpen}
            projects={LISTS}
            assigneesByProject={assigneesByProject}
            items={items}
            onOpenItem={askToSignUp}
            onClose={() => setActivityOpen(false)}
            preview={{ entries: log.map(logged), comments: initial.comments }}
          />
        </AgentSessionsProvider>
        </BoardDrag>
        </LabelsContext>
      </ItemSavesContext>
    </ItemChangesContext>
  );
}

/** A list's column as ProjectColumn draws it, without its editing controls. */
function PreviewColumn({
  list,
  items,
  filters,
  onOpenItem,
}: {
  list: PreviewList;
  items: Item[];
  filters: ItemFilters;
  onOpenItem: () => void;
}) {
  const { collapsed, setCollapsed } = useCollapsedItems(items);
  const today = useToday();
  // The rows the filters leave, as ProjectColumn decides them. Finished items
  // stay in the list here, with no Done section, so "Done today" says
  // whether they show.
  const groups = nestItems(items);
  const shown = shownInGroups(
    groups,
    (i, parent) =>
      (filters.doneToday || i.completedAt === null) &&
      matchesFilters(i, parent, filters, today),
  );
  return (
    <ColumnCard
      data-project-id={list.id}
      header={
        <>
          <span className="inline-flex shrink-0 rounded-md p-1">
            <ProjectIcon icon={list.icon} homepageUrl={null} name={list.name} size={24} />
          </span>
          <div className="flex h-8 min-w-0 flex-1 items-center gap-1">
            <span className="truncate text-base font-semibold">{list.name}</span>
            <span className="shrink-0 rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-[10px] tracking-wide text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
              {list.prefix}
            </span>
          </div>
        </>
      }
    >
      <div className="pt-1.5">
        <DraggableItemList
          projectId={list.id}
          groups={groups}
          shown={shown}
          collapsed={collapsed}
          onToggleCollapsed={(id) => setCollapsed([id], !collapsed.has(id))}
          onAddItem={noop}
          prefix={list.prefix}
          assignees={list.assignees}
          viewerId={VIEWER}
          prLinksByItem={{}}
          onOpenDetail={onOpenItem}
        />
      </div>
    </ColumnCard>
  );
}
