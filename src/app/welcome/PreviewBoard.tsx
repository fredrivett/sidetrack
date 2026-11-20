"use client";

import { CircleCheck, History, SquareKanban, Sunrise } from "lucide-react";
import { useMemo, useState } from "react";
import type { Greeting } from "@/core/agendaGreeting";
import type { AssigneeView } from "@/core/members";
import type { AgentSession, Item, Label } from "@/core/schema";
import { type AgendaSaves, AgendaSavesContext } from "@/components/agenda-saves";
import { helloNow } from "@/components/AgendaGreeting";
import { AgendaView } from "@/components/AgendaView";
import { AgentSessionsProvider } from "@/components/agent-sessions";
import { BoardHeader, BoardRail, ColumnCard } from "@/components/BoardLayout";
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
import { UserAvatar } from "@/components/UserAvatar";
import { type ItemFilters, matchesFilters, NO_FILTERS, shownInGroups } from "@/lib/filters";
import { nestItems } from "@/lib/itemTree";
import { addDays, weekday, weekSpan } from "@/lib/time";

// The landing page's board: the app's own Brief, trays, columns and item
// rows, on made-up lists kept in this component's state. It opens on the
// Brief, whose greeting is written here from the lists (previewGreeting), so
// it keeps up as they change. Ticking, assigning, due dates, dragging and
// folding checklists and sections all work, through local versions of the
// board's saves (ItemChangesContext, ItemSavesContext, AgendaSavesContext);
// nothing is sent anywhere, and a reload starts it over. Opening an item's
// dialog, which loads from the server, does nothing here.

const noop = () => {};

const person = (userId: string, name: string, image: string | null = null): AssigneeView => ({
  userId,
  username: userId,
  displayUsername: userId,
  name,
  email: null,
  image,
  isOwner: userId === VIEWER,
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
    assigneeIds: [VIEWER],
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

/** The viewer's agents, which the assignee pickers offer to start. */
const AGENTS = [
  { keyId: "amp", name: "Amp" },
  { keyId: "claude", name: "Claude" },
];
const ALL_LISTS = [...PERSONAL, ...HOME].map((l) => l.id);
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
    sentences.push(`${two(tomorrow)} ${tomorrow.length === 1 ? "is" : "are"} due tomorrow.`);
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

export function PreviewBoard({ today, now }: { today: string; now: number }) {
  const [initial] = useState(() => demo(today, now));
  const [items, setItems] = useState(initial.items);
  const [sessions, setSessions] = useState(initial.sessions);
  const [collapsedTrays, setCollapsedTrays] = useState<ReadonlySet<string>>(new Set());
  const [filters, setFilters] = useState(NO_FILTERS);
  const [view, setView] = useState<"brief" | "board">("brief");
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

  // The board's saves, applied here instead of on the server.
  const changes = useMemo<ItemChanges>(
    () => ({
      setCompleted: (item, done) =>
        setItems((list) => applyItemChange(list, { kind: "complete", item, done, at: Date.now() })),
      deleteItem: (item) => setItems((list) => applyItemChange(list, { kind: "delete", item })),
      setParent: (item, parentId) =>
        setItems((list) => applyItemChange(list, { kind: "parent", item, parentId })),
    }),
    [],
  );
  const saves = useMemo<ItemSaves>(() => {
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
    return {
      updateItem: async (id, patch) =>
        setItems((list) =>
          list.map((i) => {
            if (i.id !== id) return i;
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
          }),
        ),
      reorderItem: async (id, position) => move(id, undefined, position),
      setItemParent: async (id, parentId, position) =>
        position
          ? move(id, parentId, position)
          : setItems((list) => {
              const item = list.find((i) => i.id === id);
              return item ? applyItemChange(list, { kind: "parent", item, parentId }) : list;
            }),
      setItemsCollapsed: async (ids, collapsed) =>
        setItems((list) => list.map((i) => (ids.includes(i.id) ? { ...i, collapsed } : i))),
      startAgent: async (itemId, keyId) => {
        const name = AGENTS.find((a) => a.keyId === keyId)?.name ?? keyId;
        setSessions((list) => [...list, agentSession(itemId, name, Date.now())]);
      },
      stopAgent: async (itemId, keyId) =>
        setSessions((list) =>
          list.map((s) =>
            s.itemId === itemId && s.agentKeyId === keyId && s.finishedAt === null
              ? { ...s, finishedAt: Date.now() }
              : s,
          ),
        ),
    };
  }, []);

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
                // The board's view switch (Kanban), between the Brief and
                // the Board; the preview has no Done to switch to. The
                // underline sits on the header's bottom border: 8px of
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
                    const to = label === "Done" ? null : (label.toLowerCase() as "brief" | "board");
                    const Tab = to ? "button" : "span";
                    return (
                    <Tab
                      key={label}
                      {...(to && {
                        type: "button" as const,
                        onClick: () => setView(to),
                        "aria-pressed": view === to,
                      })}
                      className={`relative flex items-center gap-1.5 whitespace-nowrap rounded-md px-2 outline-none focus-visible:ring-2 focus-visible:ring-neutral-300 sm:px-2.5 [&_svg]:size-3.5 touch:[&_svg]:size-4 ${
                        view === to
                          ? "text-neutral-900 after:absolute after:inset-x-0 after:-bottom-[9px] after:h-0.5 after:rounded-full after:bg-neutral-900 dark:text-neutral-100 dark:after:bg-neutral-100"
                          : `text-neutral-500 dark:text-neutral-400 ${to ? "hover:text-neutral-900 dark:hover:text-neutral-100" : ""}`
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
                    </Tab>
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
              <span className={buttonVariants({ variant: "outline", size: "sm" })}>
                <History />
                <span className="hidden sm:inline">Activity</span>
              </span>
              <UserAvatar user={FRED} size={28} className="touch:size-9! touch:text-lg!" />
            </BoardHeader>
            {view === "brief" ? (
              <AgendaSavesContext value={agendaSaves}>
                <AgendaView
                  projects={[...PERSONAL, ...HOME].map((l) => ({
                    id: l.id,
                    name: l.name,
                    icon: l.icon,
                    homepageUrl: null,
                    refPrefix: l.prefix,
                  }))}
                  itemsByProject={Object.fromEntries(
                    ALL_LISTS.map((id) => [id, items.filter((i) => i.projectId === id)]),
                  )}
                  assigneesByProject={Object.fromEntries(
                    [...PERSONAL, ...HOME].map((l) => [l.id, l.assignees]),
                  )}
                  prLinksByItem={{}}
                  viewerId={VIEWER}
                  overdueCollapsed={folds.overdue}
                  noDateCollapsed={folds.noDate}
                  noDateFoldedLists={folds.lists}
                  greet
                  firstName="Fred"
                  filters={filters}
                  preview={{ greeting: previewGreeting(items, finished, today) }}
                />
              </AgendaSavesContext>
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
                    />
                  ))}
                </SpaceTray>
              ))}
            </BoardRail>
            )}
          </div>
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
}: {
  list: PreviewList;
  items: Item[];
  filters: ItemFilters;
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
          onOpenDetail={noop}
        />
      </div>
    </ColumnCard>
  );
}
