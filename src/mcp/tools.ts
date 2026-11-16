import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  type AgentOrigin,
  finishWork,
  listOpenAgentSessions,
  reportWork,
  startWork,
} from "@/core/agentSessions";
import { type AuditOrigin, listAudit } from "@/core/audit";
import {
  autoNewListIcon,
  withAutoLabelEmoji,
  withAutoLabelRename,
  withAutoListIcon,
} from "@/core/autoEmoji";
import { addComment, listComments, mentionNotice } from "@/core/comments";
import { addLabel, getLabel, listLabels, updateLabel } from "@/core/labels";
import { moveItem, previewMoveItem } from "@/core/move";
import { getDb } from "@/core/db";
import { getTimeZone } from "@/core/users";
import { nestItems } from "@/lib/itemTree";
import { projectRefPrefixes, resolveItemRef } from "@/core/itemRef";
import {
  acceptInvite,
  declineInvite,
  getUserName,
  inviteMember,
  listMembers,
  listPendingInvites,
  removeMember,
} from "@/core/members";
import {
  addItem,
  completeItem,
  deleteItem,
  getItem,
  listItems,
  listSubItems,
  ITEM_SORTS,
  type ItemSort,
  reorderItem,
  setItemParent,
  sortItems,
  uncompleteItem,
  updateItem,
} from "@/core/items";
import {
  canonicalizePrUrl,
  linkItemToPr,
  listItemsForPr,
  listPrLinksForItem,
  unlinkItemFromPr,
} from "@/core/prLinks";
import {
  createProject,
  deleteProject,
  getProject,
  getProjectWithItems,
  listAllProjectsWithItems,
  listNoDate,
  listToday,
  listProjects,
  reorderProject,
  updateProject,
} from "@/core/projects";
import {
  AUDIT_SOURCES,
  COMMENT_MAX,
  type Item,
  PROJECT_STATUSES,
  SPACE_COLORS,
  SPACE_ROLES,
} from "@/core/schema";
import {
  acceptSpaceInvite,
  createSpace,
  declineSpaceInvite,
  deleteSpace,
  inviteSpaceMember,
  listPendingSpaceInvites,
  listSpaceMembers,
  listSpaces,
  listTrays,
  PERSONAL_TRAY,
  removeSpaceMember,
  reorderSpace,
  setProjectSpace,
  setSpaceMemberRole,
  updateSpace,
} from "@/core/spaces";
import { type InviteKind, notifyInvite, notifyMentions } from "@/lib/email";
import { getEnv } from "@/lib/env";
import { formatItemRef, workPrTitle } from "@/lib/itemRef";
import { checkDraftItem } from "@/lib/itemSuggest";
import { MAX_REPEAT_EVERY, REPEAT_UNITS, type RepeatUnit, nextDue, repeatOf } from "@/lib/repeat";
import { dayOf, formatRelativeLong, isDay } from "@/lib/time";
import { matchesWhose, WHOSE_FILTERS } from "@/lib/whose";

/** The authenticated caller: the key's owner and the key itself (the agent). */
export interface McpContext {
  userId: string;
  agent: { keyId: string; name: string };
  /** The app's address, for links in the emails a tool sends. */
  baseUrl: string;
}

const Status = z.enum(PROJECT_STATUSES);
const PosRef = z
  .string()
  .regex(/^(top|end|after:.+|before:.+)$/, "expected top|end|after:<item>|before:<item>");
const DueDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "expected a calendar day, YYYY-MM-DD")
  .refine(isDay, "expected a calendar day, YYYY-MM-DD");
const Whose = z.enum(WHOSE_FILTERS);
// How add_item and update_item describe due spans, the web's This week, This
// weekend, Next week and Next weekend.
const DUE_SPAN =
  "due_from (YYYY-MM-DD) makes it due any day from due_from to due_date instead of on one day: " +
  "\"this week\" is Monday to Sunday of the current week, \"this weekend\" its Saturday to Sunday, " +
  "and \"next week\" or \"next weekend\" the same a week on. Use a span when the user names a week or weekend rather than a day. " +
  "Items carry it as dueFrom (null for a single day); a span is overdue once due_date passes. ";
const Repeat = z.object({
  every: z.number().int().min(1).max(MAX_REPEAT_EVERY),
  unit: z.enum(REPEAT_UNITS),
});
const ListPosRef = z
  .string()
  .regex(/^(start|end|after:.+|before:.+)$/, "expected start|end|after:<id>|before:<id>");

// The core still calls a list a "project" (tables, fields, types); agents see
// "list". Rename those keys on the way out, in one place, so every tool's
// output matches the tool names and inputs.
const AGENT_KEYS: Record<string, string> = {
  project: "list",
  projectId: "listId",
  projectName: "listName",
};

function forAgent(value: unknown, timeZone: string): unknown {
  if (Array.isArray(value)) return value.map((v) => forAgent(v, timeZone));
  if (value && Object.getPrototypeOf(value) === Object.prototype) {
    let obj = value as Record<string, unknown>;
    // An item's repeat rule goes out as one `repeat` field, the shape
    // add_item and update_item take: { every, unit }, or null. A finished
    // repeating item also says the day it comes back (the web's "Back Tue").
    if ("repeatUnit" in obj && "repeatEvery" in obj) {
      const { repeatEvery, repeatUnit, ...rest } = obj;
      const repeat = repeatOf({
        repeatEvery: repeatEvery as number | null,
        repeatUnit: repeatUnit as RepeatUnit | null,
      });
      obj = { ...rest, repeat };
      if (repeat && typeof obj.completedAt === "number") {
        const next = nextDue(dayOf(obj.completedAt, timeZone), repeat, {
          dueDate: (obj.dueDate as string | null) ?? null,
          dueFrom: (obj.dueFrom as string | null) ?? null,
        });
        obj.comesBack = next.dueFrom ?? next.dueDate;
      }
    }
    return Object.fromEntries(
      Object.entries(obj).map(([k, v]) => [AGENT_KEYS[k] ?? k, forAgent(v, timeZone)]),
    );
  }
  return value;
}

/** A tool result: `value` as JSON, in the agent's vocabulary. */
function jsonFor(value: unknown, timeZone: string) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(forAgent(value, timeZone), null, 2),
      },
    ],
  };
}

function notFound(kind: string, id: string) {
  return {
    isError: true,
    content: [
      { type: "text" as const, text: `${kind} not found: ${id}` },
    ],
  };
}

type Db = ReturnType<typeof getDb>["db"];

// Item targeting accepts a pasted short ref (e.g. "ENG-42") or the internal
// nanoid. Resolution is fail-closed: an ambiguous or unknown ref yields an
// error and the caller performs no mutation — the tool never guesses an item.
function resolveItemArg(db: Db, userId: string, raw: string) {
  const r = resolveItemRef(db, userId, raw);
  if (r.status === "ok") return { item: r.item, error: null as null };
  if (r.status === "ambiguous") {
    // Suggest the concrete qualified refs (owner/PREFIX), since a shared prefix
    // is disambiguated by the owner's username.
    const options = r.candidates
      .map((c) =>
        c.ownerUsername ? `${c.ownerUsername}/${c.prefix}-N` : `"${c.projectName}"`,
      )
      .join(", ");
    return {
      item: null,
      error: {
        isError: true,
        content: [
          {
            type: "text" as const,
            text:
              `Ambiguous item ref "${raw}": its prefix matches multiple lists ` +
              `you can access. Qualify it with the owner (${options}) or use the ` +
              `item's id — no change was made.`,
          },
        ],
      },
    };
  }
  return { item: null, error: notFound("item", raw) };
}

function errorText(text: string) {
  return { isError: true, content: [{ type: "text" as const, text }] };
}

// A position may name its sibling by ref ("after:HOM-12") as well as by id.
// Resolve it the same fail-closed way as item targets, check it's a sibling
// (same list, same parent) of the item being placed, and hand the core an id.
function resolvePositionArg(
  db: Db,
  userId: string,
  raw: string | undefined,
  projectId: string,
  parentId: string | null,
) {
  const m = raw?.match(/^(after|before):(.+)$/);
  if (!m) return { position: raw, error: null };
  const { item, error } = resolveItemArg(db, userId, m[2]);
  if (error) return { position: undefined, error };
  if (item.projectId !== projectId) {
    return {
      position: undefined,
      error: errorText(
        `"${m[2]}" is in a different list, so nothing can be placed ` +
          `${m[1]} it here — no change was made.`,
      ),
    };
  }
  if (item.parentId !== parentId) {
    return {
      position: undefined,
      error: errorText(
        `"${m[2]}" is ${item.parentId ? "a sub-item of another item" : "a top-level item"}, ` +
          `so this can't be placed ${m[1]} it: items only move among their siblings ` +
          `(use set_item_parent to nest or un-nest) — no change was made.`,
      ),
    };
  }
  return { position: `${m[1]}:${item.id}`, error: null };
}

// Items are stored without their (project-owned) prefix; attach the display
// `ref` at the edge so agents can echo "ENG-42" back to the user — qualified
// ("alice/ENG-42") when the prefix clashes on the viewer's board.
function withItemRef(db: Db, userId: string, item: Item) {
  const refPrefix = projectRefPrefixes(db, userId)[item.projectId];
  return {
    ...item,
    ref: refPrefix ? formatItemRef(refPrefix, item.number) : null,
  };
}

// Items with display refs, sub-items nested under their parent as `children`
// (left off items that have none).
function withRefs(prefix: string, list: Item[]) {
  return nestItems(
    list.map((i) => ({ ...i, ref: formatItemRef(prefix, i.number) })),
  ).map(({ children, ...it }) => (children.length ? { ...it, children } : it));
}

// Notify an invitee by email (best-effort; notifyInvite never throws). The
// link is the app root (McpContext.baseUrl); with no transport set, the email
// layer logs it server-side.
async function sendInviteNotification(
  db: Db,
  url: string,
  inviterId: string,
  name: string,
  toEmail: string | null,
  kind: InviteKind = "list",
) {
  if (!toEmail) return;
  await notifyInvite({
    to: toEmail,
    inviterName: getUserName(db, inviterId) ?? "Someone",
    projectName: name,
    url,
    kind,
  });
}

export function registerTools(server: McpServer, ctx: McpContext) {
  const { userId } = ctx;
  // Every mutation is logged as "mcp" plus the API key the agent used, so the
  // activity log can say which agent made each change.
  const AGENT: AgentOrigin = { source: "mcp", agent: ctx.agent };
  const SOURCE: AuditOrigin = AGENT;
  // comesBack days count in the user's zone, as the reopen does (UTC until a
  // browser reports one).
  const json = (value: unknown) =>
    jsonFor(value, getTimeZone(getDb().db, userId) ?? "UTC");

  server.registerTool(
    "list_lists",
    {
      title: "List lists",
      description:
        "List the user's lists in board order (left to right, per their own board). Returns id, name, status, summary, summaryUpdatedAt and more. " +
        "status is active (on the board) or archived (off the board and every other view, kept for reference in the Archived view). " +
        "Archived lists are left out unless include_archived is true. " +
        "spaceId is the Space the list is in (null for none); everyone in that Space can see and edit it. list_spaces gives each Space's name.",
      inputSchema: { include_archived: z.boolean().optional() },
    },
    async ({ include_archived }) => {
      const { db } = getDb();
      return json(
        listProjects(db, userId).filter(
          (l) => include_archived || l.status !== "archived",
        ),
      );
    },
  );

  server.registerTool(
    "get_list",
    {
      title: "Get list",
      description:
        "Fetch a list with its items in position order. Pass include_completed: true to also return completed items. Works for archived lists too. " +
        "A repeating item carries `repeat` ({ every, unit }); a finished one also carries `comesBack`, the day it reopens. ",
      inputSchema: {
        id: z.string(),
        include_completed: z.boolean().optional(),
      },
    },
    async ({ id, include_completed }) => {
      const { db } = getDb();
      const result = getProjectWithItems(db, userId, id, {
        includeCompleted: include_completed,
      });
      if (!result) return notFound("list", id);
      const refPrefix =
        projectRefPrefixes(db, userId)[result.project.id] ?? result.project.prefix;
      return json({
        list: result.project,
        items: withRefs(refPrefix, result.items),
      });
    },
  );

  server.registerTool(
    "list_all_items",
    {
      title: "List all items across lists",
      description:
        "Fetch every list together with its items — the whole board in one call. " +
        "Lists come back in board order; each carries its own items array in position order. " +
        "Archived lists are left out unless include_archived is true. " +
        "include_completed defaults to false; pass true only when the user explicitly wants completed items.\n" +
        "Render the result for the user as an indented tree:\n" +
        "- Each list is a top-level node; its items nest beneath it. Mark an archived list as archived.\n" +
        "- Keep lists and items in the order returned; do not re-sort unless the user asked for a different order.\n" +
        "- Do not show completed items in the tree.\n" +
        "- A task is a box-drawing branch, e.g. `├── Write the docs`.\n" +
        "- An item's sub-items (its checklist, in `children`) nest one level beneath it, e.g. `│   ├── Kitchen`.\n" +
        "- A repeating item carries `repeat` ({ every, unit }); a finished one also carries `comesBack`, the day it reopens. Mark a repeating item with its rule, e.g. `├── Water plants (every 3 days)`.",
      inputSchema: {
        include_completed: z.boolean().optional(),
        include_archived: z.boolean().optional(),
      },
    },
    async ({ include_completed, include_archived }) => {
      const { db } = getDb();
      const refs = projectRefPrefixes(db, userId);
      return json(
        listAllProjectsWithItems(db, userId, {
          includeCompleted: include_completed,
        })
          .filter(({ project }) => include_archived || project.status !== "archived")
          .map(({ project, items }) => ({
            list: project,
            items: withRefs(refs[project.id] ?? project.prefix, items),
          })),
      );
    },
  );

  server.registerTool(
    "list_today",
    {
      title: "List today",
      description:
        "What's due now on the user's Agenda view: items across their active lists (not archived) that are due today or overdue, " +
        "items due in a span that has started (dueFrom on or before today, e.g. due this week from Monday), " +
        "plus items finished today, which the user sees crossed out. Overdue items come first, then by board order. " +
        "The user sees them under Overdue (dueDate before today), Today (due today alone) and This week (a span under way); " +
        "their Agenda also shows what's due later, under This week, Next week and Later, which this tool leaves out. " +
        "Returns { today, timeZone, items }, plus a note when the timezone is a UTC fallback. today is the user's current day (YYYY-MM-DD) in timeZone, which their browser reports; " +
        "the day turns over at 4am, so at 1am it's still the day before. Use today to work out dates like tomorrow for due_date. " +
        "Each item carries its ref, listName and, for a sub-item, parentTitle. " +
        "Items carry assigneeIds, everyone they're assigned to; a joint item has several. " +
        "filter narrows to items assigned to the user, alone or jointly with others (mine), " +
        "assigned only to other people (theirs), or to nobody (unassigned). Every item falls under exactly one of the three.\n" +
        "A repeating item carries `repeat` ({ every, unit }); a finished one also carries `comesBack`, the day it reopens. " +
        "Show the user the items as a list with the list name, anything overdue marked, repeating ones with their rule, " +
        "and finished ones crossed out (a finished repeating one with the day it comes back), as on their screen.",
      inputSchema: { filter: Whose.optional() },
    },
    async ({ filter }) => {
      const { db } = getDb();
      const savedZone = getTimeZone(db, userId);
      const timeZone = savedZone ?? "UTC";
      const { today, items } = listToday(db, userId, { timeZone });
      const keep = items.filter((it) => matchesWhose(it, filter ?? "all", userId));
      const refs = projectRefPrefixes(db, userId);
      const names = new Map(listProjects(db, userId).map((p) => [p.id, p.name]));
      const titles = new Map<string, string>();
      for (const it of keep) {
        if (it.parentId && !titles.has(it.parentId)) {
          titles.set(it.parentId, getItem(db, userId, it.parentId)?.title ?? "");
        }
      }
      return json({
        today,
        timeZone,
        ...(savedZone
          ? {}
          : {
              note: "The user's timezone isn't known until they open Sidetrack in a browser, so today is the day in UTC.",
            }),
        items: keep.map((it) => ({
          ...it,
          ref: formatItemRef(refs[it.projectId] ?? "", it.number),
          listName: names.get(it.projectId) ?? null,
          ...(it.parentId ? { parentTitle: titles.get(it.parentId) } : {}),
        })),
      });
    },
  );

  server.registerTool(
    "list_no_date",
    {
      title: "List items with no date",
      description:
        "The No date section of the user's Agenda view: tasks with no due date across their active lists (not archived), " +
        "for planning when to do them. Sub-items of a dated parent are left out, since they are planned with their parent. " +
        "Items finished today are included, which the user sees crossed out. " +
        "Returns { today, timeZone, lists }, plus a note when the timezone is a UTC fallback; today works as in list_today. " +
        "lists is in board order, each { list, items } with items in list order and an undated parent's undated sub-items nested in children; " +
        "lists with nothing undated are left out. A sub-item whose parent isn't shown carries parentTitle. " +
        "Items carry assigneeIds, everyone they're assigned to; a joint item has several. " +
        "filter narrows to items assigned to the user, alone or jointly with others (mine), " +
        "assigned only to other people (theirs), or to nobody (unassigned), as in list_today.\n" +
        "A repeating item carries `repeat` ({ every, unit }); a finished one also carries `comesBack`, the day it reopens. " +
        "Show the user the items grouped under each list name, sub-items indented, repeating ones with their rule, finished ones crossed out, as on their screen. " +
        "To give an item a date, call update_item with due_date.",
      inputSchema: { filter: Whose.optional() },
    },
    async ({ filter }) => {
      const { db } = getDb();
      const savedZone = getTimeZone(db, userId);
      const timeZone = savedZone ?? "UTC";
      const { today, lists } = listNoDate(db, userId, { timeZone });
      const refs = projectRefPrefixes(db, userId);
      // Siblings share a parent, so look each parent's title up once.
      const titles = new Map<string, string | null>();
      const parentTitle = (id: string) => {
        if (!titles.has(id)) titles.set(id, getItem(db, userId, id)?.title ?? null);
        return titles.get(id) ?? null;
      };
      return json({
        today,
        timeZone,
        ...(savedZone
          ? {}
          : {
              note: "The user's timezone isn't known until they open Sidetrack in a browser, so today is the day in UTC.",
            }),
        lists: lists.flatMap(({ project, items }) => {
          const keep = items.filter((it) => matchesWhose(it, filter ?? "all", userId));
          if (keep.length === 0) return [];
          return [
            {
              list: project,
              items: withRefs(refs[project.id] ?? project.prefix, keep).map((it) =>
                it.parentId
                  ? { ...it, parentTitle: parentTitle(it.parentId) }
                  : it,
              ),
            },
          ];
        }),
      });
    },
  );

  server.registerTool(
    "create_list",
    {
      title: "Create list",
      description:
        "Create a new list, such as \"Home\", \"Buy\" or \"Launch Library\". Appends at the right of the board. " +
        "status defaults to active. summary, homepage_url, and icon are optional and work as in update_list; " +
        "without an icon, the list gets an emoji suggested for its name (or shows its homepage's favicon), as on the web; " +
        "icon: null creates it with no icon, as the user's choice. " +
        "space_id (from list_spaces) creates it in a Space the user has joined, shared with everyone in it; leave it out for a list of their own.",
      inputSchema: {
        name: z.string().min(1),
        status: Status.optional(),
        summary: z.string().optional(),
        homepage_url: z.string().optional(),
        icon: z.string().nullable().optional(),
        space_id: z.string().min(1).optional(),
      },
    },
    async ({ homepage_url, space_id, icon, ...input }) => {
      const { db } = getDb();
      const chosen = icon !== undefined;
      const homepageUrl = homepage_url;
      return json(
        createProject(
          db,
          userId,
          {
            ...input,
            homepageUrl,
            icon: chosen ? icon : await autoNewListIcon({ ...input, homepageUrl }),
            iconChosen: chosen,
            spaceId: space_id,
          },
          SOURCE,
        ),
      );
    },
  );

  server.registerTool(
    "update_list",
    {
      title: "Update list",
      description:
        "Patch name/status/summary/prefix/homepage_url/icon. Setting summary stamps summaryUpdatedAt. " +
        "status is active or archived (take it off the board and every other view, into the Archived view; its items are kept, and setting active restores it). Archive a list the user wants to set aside for now. " +
        "Archive a finished list rather than deleting it unless the user asks to delete. " +
        "prefix is the short item-ID prefix (2–5 letters, e.g. \"ENG\" → items like ENG-42); " +
        "it is uppercased, and an auto-suffix is applied if it collides with another list. " +
        "homepage_url is the list's public landing URL — a bare host gains an https:// scheme; pass null to clear it. " +
        "icon is the list icon: an emoji (e.g. \"🚀\") or an http(s) image URL; pass null for no icon (it falls back to the homepage favicon). " +
        "Setting icon, null included, is the user's choice and stays; until someone sets one, the icon follows an emoji suggested for the list's name, summary and homepage, " +
        "updated when you change them (iconChosen says which). " +
        "space_id moves the list into a Space the user has joined (from list_spaces), or out of its Space with null; only the list's owner can, " +
        "except that an admin of its Space can take it out, which returns it to its owner. The other fields are saved before the move.",
      inputSchema: {
        id: z.string(),
        name: z.string().optional(),
        status: Status.optional(),
        summary: z.string().optional(),
        prefix: z.string().optional(),
        homepage_url: z.string().nullable().optional(),
        icon: z.string().nullable().optional(),
        space_id: z.string().min(1).nullable().optional(),
      },
    },
    async ({ id, homepage_url, space_id, ...patch }) => {
      const { db } = getDb();
      if (!getProject(db, userId, id)) return notFound("list", id);
      const updated = updateProject(
        db,
        userId,
        id,
        await withAutoListIcon(
          db,
          userId,
          id,
          homepage_url === undefined ? patch : { ...patch, homepageUrl: homepage_url },
        ),
        SOURCE,
      );
      if (space_id === undefined) return json(updated);
      setProjectSpace(db, userId, id, space_id, SOURCE);
      // An admin taking someone else's list out of the Space can lose it.
      return json(
        getProject(db, userId, id) ?? {
          id,
          note: "The list left its Space and went back to its owner, so the user no longer has access to it.",
        },
      );
    },
  );

  server.registerTool(
    "reorder_list",
    {
      title: "Reorder list",
      description:
        "Move a list on the user's board. position is one of: start | end | after:<id> | before:<id>.",
      inputSchema: {
        id: z.string(),
        position: ListPosRef,
      },
    },
    async ({ id, position }) => {
      const { db } = getDb();
      if (!getProject(db, userId, id)) return notFound("list", id);
      return json(reorderProject(db, userId, id, position, SOURCE));
    },
  );

  server.registerTool(
    "delete_list",
    {
      title: "Delete list",
      description:
        "Permanently delete a list and all its items (owner only). To set a finished list aside, archive it with update_list instead.",
      inputSchema: { id: z.string() },
    },
    async ({ id }) => {
      const { db } = getDb();
      deleteProject(db, userId, id, SOURCE);
      return json({ ok: true });
    },
  );

  server.registerTool(
    "get_item",
    {
      title: "Get item",
      description:
        "Fetch a single item by reference — its title, description, labels (names; see list_labels for their emoji), assignees (assigneeIds, user ids; empty when unassigned) and completion state, " +
        "plus its sub-items (its checklist) as `children`, finished ones included. A sub-item has a parentId. " +
        "Use this to answer a question about one item without pulling its whole list. " +
        "A repeating item carries `repeat` ({ every, unit }); a finished one also carries `comesBack`, the day it reopens. " +
        "`agents` lists the agents working on it now (open start_work sessions: agentName, threadUrl, note, lastActiveAt); " +
        "check it before starting work so you don't duplicate another agent's. " +
        "`comments` is its discussion, oldest first: each has body (Markdown), author (name, displayUsername), agentName when an agent wrote it for that person, createdAt and editedAt. " +
        "Read them before working on the item: they often hold decisions and context the description doesn't. " +
        "id accepts the item's short ref (e.g. \"ENG-42\") or its internal id; the result carries its display `ref`.",
      inputSchema: { id: z.string() },
    },
    async ({ id }) => {
      const { db } = getDb();
      const { item, error } = resolveItemArg(db, userId, id);
      if (error) return error;
      const withRef = withItemRef(db, userId, item);
      const prefix = projectRefPrefixes(db, userId)[item.projectId] ?? "";
      const children = listSubItems(db, userId, item.id);
      return json({
        ...withRef,
        children: withRefs(prefix, children),
        agents: listOpenAgentSessions(db, userId, item.id),
        comments: listComments(db, userId, item.id),
      });
    },
  );

  server.registerTool(
    "add_comment",
    {
      title: "Add comment",
      description:
        "Comment on an item: body is Markdown, shown in the item's detail view under your name and the user's. " +
        "Use it for what people discussing the item should read later, such as a question for the user, a decision and why, or a summary of findings. " +
        "Use report_work for one-line progress updates and update_item for what the item itself should say. " +
        "To get someone's attention, mention them with @ and their username (e.g. \"@fred\"): a comment author's displayUsername, " +
        "or a member's username from list_members. Anyone mentioned who can open the item is emailed the comment, " +
        "including the user you act for, so mention them when you need their answer and not otherwise. " +
        `Max ${COMMENT_MAX} characters. Returns the comment. ` +
        "item_id accepts the item's short ref (e.g. \"ENG-42\") or its internal id.",
      inputSchema: { item_id: z.string(), body: z.string().min(1) },
    },
    async ({ item_id, body }) => {
      const { db } = getDb();
      const { item, error } = resolveItemArg(db, userId, item_id);
      if (error) return error;
      let comment;
      try {
        comment = addComment(db, userId, item.id, body, SOURCE);
      } catch (e) {
        return errorText(`${(e as Error).message} — no change was made.`);
      }
      const notice = mentionNotice(db, userId, comment);
      if (notice) {
        await notifyMentions(notice, ctx.baseUrl);
      }
      return json(comment);
    },
  );

  server.registerTool(
    "add_item",
    {
      title: "Add item",
      description:
        "Add a task to a list. description is optional free-text. " +
        "labels is a list of label names, e.g. [\"bug\", \"urgent\"]; a name the list has no label for yet is added to it, with a suggested emoji. " +
        "category (one name) is the older input for a single label, kept so older prompts work; don't pass both. " +
        "parent (a short ref or id) adds the task as a sub-item of that task, one step in its checklist: " +
        "e.g. \"Tidy up flat\" with sub-items Lounge, Kitchen and Bedroom. Sub-items are one level deep; " +
        "each is a full item with its own ref and assignees. Adding an open one to a finished parent reopens the parent; adding one with completed: true leaves it finished. " +
        "sub_items (titles, in order) creates the task's checklist with it in one call, all or nothing: " +
        "prefer it over adding each sub-item with parent afterwards. With completed: true they're created done too. Not with parent, since sub-items can't have their own. " +
        "due_date is the calendar day it's due, YYYY-MM-DD (no time); call list_today first if you need today's date in the user's timezone. " +
        DUE_SPAN +
        "assignee_ids assigns it to one or more people, each the list owner (the list's userId) or an accepted member " +
        "(user_id from list_members), or \"me\" for the user you act for; several make a joint item. " +
        "assignee_id (one id) also works, for older prompts; don't pass both. " +
        "completed: true creates it already done, in one call — use it when the user tells you about something they've finished, " +
        "instead of add_item then complete_item. " +
        "repeat makes a task come round again: { every, unit } with unit day, week or month, e.g. { every: 3, unit: \"day\" } for every 3 days. " +
        "The next due date counts from the day it was last completed, not a fixed calendar: completing it leaves it crossed out for the rest of the day, " +
        "then on the day `every` units after the day it was done it reopens as the same item (same ref), due that day. " +
        "A repeating week or weekend (due_from set) comes back as the week or weekend that day falls in, reopening on its first day, " +
        "so a weekly \"this week\" item done on Wednesday reopens on Monday, due next week. " +
        "A month later keeps the day of the month, or the month's last day when that's shorter. " +
        "position defaults to end (the bottom of the list, or of the parent's sub-items); top|end|after:<item>|before:<item> are also valid, " +
        "where <item> is a short ref (e.g. \"HOM-12\") or an id of a sibling (same list, same parent). " +
        "Returns { created, items } where items is every incomplete item in the list in position order " +
        "(so an item created completed is in created but not items). " +
        "It also has possible_duplicate ({ id, ref, title }) when an open item already in the list looks like the same task, " +
        "identical or reworded. The new item is created either way. Then tell the user, naming both refs, and ask before deleting either; " +
        "delete only what they confirm. If you created it completed, ask whether they meant to complete the open one instead.\n" +
        "After adding, show the user the list's updated items (the items array) so they can see where " +
        "the new item landed, unless the user asked you not to:\n" +
        "- Keep items in the order returned; do not re-sort unless the user asked for a different order.\n" +
        "- A task is a box-drawing branch, e.g. `├── Write the docs`.\n" +
        "- Sub-items (in `children`) nest one level beneath their parent, e.g. `│   ├── Kitchen`.\n" +
        "- Show the description of the item you added (the one whose id is created.id) inline, indented on the line beneath its branch; " +
        "leave out every other item's description. If you created it completed, it isn't in items: show it and its description after the tree, marked done.",
      inputSchema: {
        list_id: z.string(),
        title: z.string().min(1),
        description: z.string().optional(),
        labels: z.array(z.string().min(1)).optional(),
        category: z.string().optional(),
        parent: z.string().optional(),
        due_date: DueDate.nullable().optional(),
        due_from: DueDate.nullable().optional(),
        assignee_ids: z.array(z.string().min(1)).optional(),
        assignee_id: z.string().optional(),
        completed: z.boolean().optional(),
        repeat: Repeat.nullable().optional(),
        position: PosRef.optional(),
        sub_items: z.array(z.string().min(1)).optional(),
      },
    },
    async ({
      list_id,
      title,
      description,
      labels,
      category,
      parent,
      due_date,
      due_from,
      assignee_ids,
      assignee_id,
      completed,
      repeat,
      position,
      sub_items,
    }) => {
      const { db } = getDb();
      if (parent !== undefined && sub_items !== undefined) {
        return errorText(
          "Pass parent or sub_items, not both: sub-items can't have their own — no change was made.",
        );
      }
      if (assignee_ids !== undefined && assignee_id !== undefined) {
        return errorText(
          "Pass assignee_ids or the older assignee_id, not both — no change was made.",
        );
      }
      if (labels !== undefined && category !== undefined) {
        return errorText("Pass labels or the older category, not both — no change was made.");
      }
      const labelNames = category !== undefined ? [category] : labels;
      const assigneeIds = (assignee_id ? [assignee_id] : assignee_ids)?.map((a) =>
        a === "me" ? userId : a,
      );
      const project = getProject(db, userId, list_id);
      if (!project) return notFound("list", list_id);
      let parentId: string | null = null;
      if (parent) {
        const r = resolveItemArg(db, userId, parent);
        if (r.error) return r.error;
        if (r.item.projectId !== project.id) {
          return errorText(
            `"${parent}" is in a different list; a sub-item must be in its parent's list — no change was made.`,
          );
        }
        parentId = r.item.id;
      }
      const pos = resolvePositionArg(db, userId, position, project.id, parentId);
      if (pos.error) return pos.error;
      // The list's open items before the add, to check the new one against.
      const apiKey = getEnv().TYPESAFE_API_KEY;
      const before = apiKey ? listItems(db, userId, list_id) : [];
      const labelEmoji = await withAutoLabelEmoji(db, userId, list_id, labelNames);
      const created = addItem(
        db,
        userId,
        {
          projectId: list_id,
          title,
          description,
          labels: labelNames,
          labelEmoji,
          parentId,
          dueDate: due_date,
          dueFrom: due_from,
          assigneeIds,
          completed,
          repeat,
          positionRef: pos.position,
          subItems: sub_items,
        },
        SOURCE,
      );
      const refPrefix = projectRefPrefixes(db, userId)[list_id] ?? project.prefix;
      // Only the duplicate question: no item is offered as a parent.
      const { duplicateId } = apiKey
        ? await checkDraftItem(
            { title: created.title, description: created.description ?? "" },
            before.map((it) => ({ id: it.id, title: it.title, topLevel: false })),
            apiKey,
          )
        : { duplicateId: null };
      const duplicate = before.find((it) => it.id === duplicateId);
      return json({
        created: { ...created, ref: formatItemRef(refPrefix, created.number) },
        items: withRefs(refPrefix, listItems(db, userId, list_id)),
        ...(duplicate && {
          possible_duplicate: {
            id: duplicate.id,
            ref: formatItemRef(refPrefix, duplicate.number),
            title: duplicate.title,
          },
        }),
      });
    },
  );

  server.registerTool(
    "update_item",
    {
      title: "Update item",
      description:
        "Patch title/description/labels/assignees/due_date/repeat on an item. Pass description as null to clear it. " +
        "labels is every label the item has, replacing the ones it had; [] takes them all off. A new name is added to the list, with a suggested emoji. " +
        "category (one name, or null for none) is the older single-label input, kept so older prompts work; don't pass both. " +
        "assignee_ids is everyone the item is assigned to, replacing who it had; several people make a joint item " +
        "(e.g. \"Discuss Christmas travel\" for both of them). Each entry is a user id of the list owner (the list's userId) " +
        "or an accepted member (from list_members), or \"me\" for the user you act for. [] unassigns everyone. " +
        "To add or take off people while leaving everyone else, use add_assignee_ids and/or remove_assignee_ids instead " +
        "(same kinds of ids, \"me\" included): they apply to whoever is assigned when the change lands, so they never undo " +
        "someone else's change made since you last read the item. Prefer them over assignee_ids unless you mean to set the whole list. " +
        "assignee_id (one id, or null) is the old single-assignee input, kept so older prompts work: " +
        "it makes that person the only assignee, or null unassigns everyone. " +
        "Pass only one of assignee_ids, assignee_id, or add/remove. " +
        "due_date sets the calendar day it's due (YYYY-MM-DD, no time); pass null to clear it. " +
        DUE_SPAN +
        "Passing due_date without due_from makes it due that day alone. due_from without due_date changes when the span starts and keeps its due_date; " +
        "due_from: null makes it due on its due_date alone. " +
        "repeat sets how often a task comes round again, { every, unit } (see add_item); pass null to stop it repeating. " +
        "id accepts the item's short ref (e.g. \"ENG-42\") or its internal id. " +
        "Returns { updated, items } where items is every incomplete item in the item's list in position order " +
        "(so a completed item is in updated but not items).\n" +
        "After updating, show the user the list's items (the items array) so they can see the change in place, " +
        "unless the user asked you not to:\n" +
        "- Keep items in the order returned; do not re-sort unless the user asked for a different order.\n" +
        "- A task is a box-drawing branch, e.g. `├── Write the docs`.\n" +
        "- Sub-items (in `children`) nest one level beneath their parent, e.g. `│   ├── Kitchen`.\n" +
        "- Show the description of the item you updated (the one whose id is updated.id) inline, indented on the line beneath its branch; " +
        "leave out every other item's description. If it's completed, it isn't in items: show it and its description after the tree, marked done.",
      inputSchema: {
        id: z.string(),
        title: z.string().optional(),
        description: z.string().nullable().optional(),
        labels: z.array(z.string().min(1)).optional(),
        category: z.string().nullable().optional(),
        assignee_ids: z.array(z.string().min(1)).optional(),
        assignee_id: z.string().nullable().optional(),
        add_assignee_ids: z.array(z.string().min(1)).optional(),
        remove_assignee_ids: z.array(z.string().min(1)).optional(),
        due_date: DueDate.nullable().optional(),
        due_from: DueDate.nullable().optional(),
        repeat: Repeat.nullable().optional(),
      },
    },
    async ({
      id,
      assignee_ids,
      assignee_id,
      add_assignee_ids,
      remove_assignee_ids,
      due_date,
      due_from,
      labels,
      category,
      ...patch
    }) => {
      const { db } = getDb();
      const { item, error } = resolveItemArg(db, userId, id);
      if (error) return error;
      const ways = [
        assignee_ids !== undefined,
        assignee_id !== undefined,
        add_assignee_ids !== undefined || remove_assignee_ids !== undefined,
      ].filter(Boolean).length;
      if (ways > 1) {
        return errorText(
          "Pass only one of assignee_ids, the older assignee_id, or add_assignee_ids/remove_assignee_ids — no change was made.",
        );
      }
      const me = (ids?: string[]) => ids?.map((a) => (a === "me" ? userId : a));
      const given =
        assignee_id === undefined ? assignee_ids : assignee_id ? [assignee_id] : [];
      const assigneeIds = me(given);
      const addAssigneeIds = me(add_assignee_ids);
      const removeAssigneeIds = me(remove_assignee_ids);
      const both = addAssigneeIds?.filter((a) => removeAssigneeIds?.includes(a)) ?? [];
      if (both.length) {
        return errorText(
          `${both.join(", ")} is in both add_assignee_ids and remove_assignee_ids — no change was made.`,
        );
      }
      if (labels !== undefined && category !== undefined) {
        return errorText("Pass labels or the older category, not both — no change was made.");
      }
      const labelNames =
        category === undefined ? labels : category === null ? [] : [category];
      const labelEmoji = await withAutoLabelEmoji(db, userId, item.projectId, labelNames);
      const updated = updateItem(
        db,
        userId,
        item.id,
        {
          ...patch,
          labels: labelNames,
          labelEmoji,
          assigneeIds,
          addAssigneeIds,
          removeAssigneeIds,
          dueDate: due_date,
          dueFrom: due_from,
        },
        SOURCE,
      );
      const refPrefix = projectRefPrefixes(db, userId)[updated.projectId];
      return json({
        updated: { ...updated, ref: formatItemRef(refPrefix, updated.number) },
        items: withRefs(refPrefix, listItems(db, userId, updated.projectId)),
      });
    },
  );

  server.registerTool(
    "complete_item",
    {
      title: "Complete item",
      description:
        "Mark an item as completed. It keeps its place in the list: the user sees it crossed out for the rest of the day " +
        "(the day turns over at 4am their time), then it moves to the list's Done section. " +
        "Completing an item with sub-items also completes its open sub-items; completing a parent's last open sub-item completes the parent too. " +
        "A repeating item (one with a repeat rule) reopens by itself on its next due date: `every` units after the day it was completed. " +
        "The result then carries `comesBack`, that day (YYYY-MM-DD); tell the user when it'll be back. " +
        "id accepts the item's short ref (e.g. \"ENG-42\") or its internal id.",
      inputSchema: { id: z.string() },
    },
    async ({ id }) => {
      const { db } = getDb();
      const { item, error } = resolveItemArg(db, userId, id);
      if (error) return error;
      return json(
        withItemRef(db, userId, completeItem(db, userId, item.id, SOURCE)),
      );
    },
  );

  server.registerTool(
    "uncomplete_item",
    {
      title: "Uncomplete item",
      description:
        "Reopen a completed item. It returns to the same place in the list it had before. " +
        "Reopening a sub-item of a finished parent reopens the parent too; reopening a parent leaves its sub-items as they are. " +
        "id accepts the item's short ref (e.g. \"ENG-42\") or its internal id.",
      inputSchema: { id: z.string() },
    },
    async ({ id }) => {
      const { db } = getDb();
      const { item, error } = resolveItemArg(db, userId, id);
      if (error) return error;
      return json(
        withItemRef(db, userId, uncompleteItem(db, userId, item.id, SOURCE)),
      );
    },
  );

  server.registerTool(
    "reorder_item",
    {
      title: "Reorder item",
      description:
        "Move an item within its list, among its siblings: top-level items among top-level items, " +
        "a sub-item among its parent's sub-items. position is top | end | after:<item> | before:<item>, " +
        "where <item> is a short ref (e.g. \"HOM-12\") or an id of a sibling. " +
        "To nest or un-nest an item, use set_item_parent. " +
        "id accepts the item's short ref (e.g. \"ENG-42\") or its internal id.",
      inputSchema: { id: z.string(), position: PosRef },
    },
    async ({ id, position }) => {
      const { db } = getDb();
      const { item, error } = resolveItemArg(db, userId, id);
      if (error) return error;
      const pos = resolvePositionArg(
        db,
        userId,
        position,
        item.projectId,
        item.parentId,
      );
      if (pos.error) return pos.error;
      return json(
        withItemRef(
          db,
          userId,
          reorderItem(db, userId, item.id, pos.position ?? "end", SOURCE),
        ),
      );
    },
  );

  server.registerTool(
    "sort_items",
    {
      title: "Sort items",
      description:
        "Sort a list's top-level items once, as the web's \"Sort items by\" does. by is one of: " +
        "\"due\" (due date, soonest first, a span by its last day, undated items last), " +
        "\"created\" (date created, newest first) or \"title\" (A to Z). " +
        "Items that tie keep their current order, and sub-items move with their parent. " +
        "It rewrites the list's order rather than keeping it sorted: items added or moved later go where they're put. " +
        "Returns changed (false when the list was already in that order, so nothing changed) and the list's open items in their new order.",
      inputSchema: {
        list_id: z.string(),
        by: z.enum(Object.keys(ITEM_SORTS) as [ItemSort, ...ItemSort[]]),
      },
    },
    async ({ list_id, by }) => {
      const { db } = getDb();
      const project = getProject(db, userId, list_id);
      if (!project) return notFound("list", list_id);
      const changed = sortItems(db, userId, list_id, by, SOURCE) !== null;
      const refPrefix = projectRefPrefixes(db, userId)[list_id] ?? project.prefix;
      return json({ changed, items: withRefs(refPrefix, listItems(db, userId, list_id)) });
    },
  );

  server.registerTool(
    "set_item_parent",
    {
      title: "Set item parent",
      description:
        "Make an item a sub-item of another task in the same list (it goes to the end of that task's checklist), " +
        "or pass parent: null to move it back out to the top level, straight after its old parent. " +
        "position places it elsewhere at its destination: top | end | after:<ref> | before:<ref>, where the anchor is one of the new parent's sub-items (or a top-level item when moving out). " +
        "If the item already has that parent, nothing changes; use reorder_item to move it among its siblings. " +
        "Sub-items are one level deep: the parent can't itself be a sub-item, and an item that has sub-items can't become one. " +
        "id and parent accept a short ref (e.g. \"ENG-42\") or an internal id.",
      inputSchema: {
        id: z.string(),
        parent: z.string().nullable(),
        position: PosRef.optional(),
      },
    },
    async ({ id, parent, position }) => {
      const { db } = getDb();
      const { item, error } = resolveItemArg(db, userId, id);
      if (error) return error;
      let parentId: string | null = null;
      if (parent) {
        const r = resolveItemArg(db, userId, parent);
        if (r.error) return r.error;
        parentId = r.item.id;
      }
      const pos = resolvePositionArg(db, userId, position, item.projectId, parentId);
      if (pos.error) return pos.error;
      try {
        return json(
          withItemRef(
            db,
            userId,
            setItemParent(db, userId, item.id, parentId, SOURCE, pos.position),
          ),
        );
      } catch (e) {
        return errorText(`${(e as Error).message} — no change was made.`);
      }
    },
  );

  server.registerTool(
    "move_item",
    {
      title: "Move item to another list",
      description:
        "Move an item, with its sub-items, to another list (a sub-item moved on its own leaves its checklist). " +
        "It lands at the top of the list unless position says where among its top-level items: top | end | after:<item> | before:<item>, " +
        "where <item> is a short ref (e.g. \"OPS-12\") or an id of a top-level item in that list. Pass the same position on both calls. " +
        "Moving changes the item's ref: each item that moves gets the next number in the new list, or its old one if it was there before, " +
        "and its old ref keeps working for anyone who can see the list it's in now. " +
        "Call it first without token: that only previews the move and changes nothing. It returns refs (each item's ref now and the one it gets), " +
        "matchedLabels (labels the list already has, which the items take on), missingLabels (labels it doesn't have), " +
        "unassigned (people who can't see the list, so they come off the items) and a token. Each label and person has itemIds: the moving items it's on (match them to refs by id), so say which items when sub-items move. " +
        "Show the user all of that and ask them to confirm the move; when missingLabels isn't empty, also ask, for each of those labels, whether to create it in the new list or drop it from the items. " +
        "Then call again with that token, and missing_labels as they chose (required when there are missing labels): \"create\" or \"drop\" for all of them, or an object from each missing label's name to \"create\" or \"drop\". " +
        "The move only happens with the token from its preview, and is refused if anything in it has changed since: then preview again and show the user the new one. " +
        "Never pass the token for a move the user hasn't seen and agreed to. " +
        "id accepts the item's short ref (e.g. \"ENG-42\") or its internal id; list_id is the target list's id.",
      inputSchema: {
        id: z.string(),
        list_id: z.string(),
        position: PosRef.optional(),
        missing_labels: z
          .union([
            z.enum(["create", "drop"]),
            z.record(z.string(), z.enum(["create", "drop"])),
          ])
          .optional(),
        token: z.string().optional(),
      },
    },
    async ({ id, list_id, position, missing_labels, token }) => {
      const { db } = getDb();
      const { item, error } = resolveItemArg(db, userId, id);
      if (error) return error;
      if (!getProject(db, userId, list_id)) return notFound("list", list_id);
      // Checked on the preview too, so a bad anchor shows before the user agrees.
      const pos = resolvePositionArg(db, userId, position, list_id, null);
      if (pos.error) return pos.error;
      try {
        if (token === undefined) {
          return json({ moved: false, ...previewMoveItem(db, userId, item.id, list_id) });
        }
        const { item: moved, ...plan } = moveItem(
          db,
          userId,
          item.id,
          { projectId: list_id, token, missingLabels: missing_labels, position: pos.position },
          SOURCE,
        );
        // The token is spent: the move changed what it named.
        return json({ moved: true, ...plan, token: undefined, item: withItemRef(db, userId, moved) });
      } catch (e) {
        return errorText(`${(e as Error).message} — no change was made.`);
      }
    },
  );

  server.registerTool(
    "delete_item",
    {
      title: "Delete item",
      description:
        "Delete an item, along with its sub-items if it has any. id accepts the item's short ref (e.g. \"ENG-42\") or its internal id.",
      inputSchema: { id: z.string() },
    },
    async ({ id }) => {
      const { db } = getDb();
      const { item, error } = resolveItemArg(db, userId, id);
      if (error) return error;
      const { ref } = withItemRef(db, userId, item);
      deleteItem(db, userId, item.id, SOURCE);
      return json({ ok: true, ref });
    },
  );

  server.registerTool(
    "link_item_to_pr",
    {
      title: "Link item to PR",
      description:
        "Associate an item with a GitHub pull request URL. Idempotent: linking the same item/PR pair twice is a no-op. " +
        "Items can have many linked PRs and PRs can be linked from many items. " +
        "Call this after raising the PR so a later merge can resolve it back to the item(s) it closes. " +
        "item_id accepts the item's short ref (e.g. \"ENG-42\") or its internal id.",
      inputSchema: { item_id: z.string(), pr_url: z.string().min(1) },
    },
    async ({ item_id, pr_url }) => {
      const { db } = getDb();
      const { item, error } = resolveItemArg(db, userId, item_id);
      if (error) return error;
      return json(linkItemToPr(db, userId, item.id, pr_url, SOURCE));
    },
  );

  server.registerTool(
    "unlink_item_from_pr",
    {
      title: "Unlink item from PR",
      description:
        "Remove a previously-set item↔PR link. No-op if the link doesn't exist. " +
        "item_id accepts the item's short ref (e.g. \"ENG-42\") or its internal id.",
      inputSchema: { item_id: z.string(), pr_url: z.string().min(1) },
    },
    async ({ item_id, pr_url }) => {
      const { db } = getDb();
      const { item, error } = resolveItemArg(db, userId, item_id);
      if (error) return error;
      unlinkItemFromPr(db, userId, item.id, pr_url, SOURCE);
      return json({ ok: true });
    },
  );

  server.registerTool(
    "list_item_pr_links",
    {
      title: "List PR links for item",
      description:
        "Return all PR URLs linked to an item (oldest first). " +
        "item_id accepts the item's short ref (e.g. \"ENG-42\") or its internal id.",
      inputSchema: { item_id: z.string() },
    },
    async ({ item_id }) => {
      const { db } = getDb();
      const { item, error } = resolveItemArg(db, userId, item_id);
      if (error) return error;
      return json(listPrLinksForItem(db, userId, item.id));
    },
  );

  server.registerTool(
    "list_items_for_pr",
    {
      title: "List items for PR",
      description:
        "Resolve a GitHub pull request URL back to the item(s) linked to it. " +
        "This is the merge-time companion to link_item_to_pr: when a PR merges, call this to find the " +
        "item(s) it closes, then complete_item each one. " +
        "Returns the full items (with their display `ref`), in no particular order; an empty array means no item is linked to that PR.",
      inputSchema: { pr_url: z.string().min(1) },
    },
    async ({ pr_url }) => {
      const { db } = getDb();
      let prUrl: string;
      try {
        prUrl = canonicalizePrUrl(pr_url);
      } catch (e) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: e instanceof Error ? e.message : `invalid pr_url: ${pr_url}`,
            },
          ],
        };
      }
      const items = listItemsForPr(db, userId, prUrl)
        .map((link) => getItem(db, userId, link.itemId))
        .filter((item): item is Item => item !== undefined)
        .map((item) => withItemRef(db, userId, item));
      return json(items);
    },
  );

  server.registerTool(
    "list_labels",
    {
      title: "List labels",
      description:
        "List a list's labels: each has an id, a name (what items carry in `labels`) and an optional emoji. " +
        "Show a label as its emoji then its name, e.g. \"🐛 bug\". emojiChosen is true when someone chose the emoji (or chose none); " +
        "otherwise it's suggested for the name and follows renames.",
      inputSchema: { list_id: z.string() },
    },
    async ({ list_id }) => {
      const { db } = getDb();
      return json(listLabels(db, userId, list_id));
    },
  );

  // Work sessions: how an agent shows the board it's working on an item. The
  // conventions they rely on (branch, PR title) are spelled out in the server
  // instructions too, so an agent learns them on connect.
  server.registerTool(
    "start_work",
    {
      title: "Start work on item",
      description:
        "Call this when you begin working on an item (coding it, researching it, anything that takes more than a moment). " +
        "Find the item first: an open item that describes the work in the list the repository's AGENTS.md names (else the one the user names), " +
        "creating one with add_item if none matches and asking the user if unsure; then call this " +
        "so the user sees you on it: you appear on the item's row and in its detail view, marked working. " +
        "If nobody is assigned, it assigns the user you act for; existing assignees are kept. " +
        "thread_url is a link to your own thread or session (e.g. an Amp or Claude thread URL) so the user can follow along; pass it whenever you have one. " +
        "Calling it again on the same item resumes your session (and updates thread_url). Refused for a completed item. " +
        "Returns the session plus `branch` and `pr_title`: name your git branch `branch` and title your pull request `pr_title` " +
        "(the item's ref in square brackets at the end), then link the PR with link_item_to_pr. " +
        "One pull request covers one item: for work that needs several PRs, give the item a sub-item per PR and start work on each sub-item, not the parent. " +
        "While working, call report_work at milestones. Your session lasts until the PR merges (completing the item ends it) or closes, unless another PR for the item is still open; call finish_work only when the work ends without merging. " +
        "item_id accepts the item's short ref (e.g. \"ENG-42\") or its internal id.",
      inputSchema: { item_id: z.string(), thread_url: z.string().optional() },
    },
    async ({ item_id, thread_url }) => {
      const { db } = getDb();
      const { item, error } = resolveItemArg(db, userId, item_id);
      if (error) return error;
      try {
        const session = startWork(db, userId, item.id, { threadUrl: thread_url }, AGENT);
        // The ref as the user's board shows it: owner-qualified (alice/ENG-42)
        // when the prefix clashes there, like every other tool's `ref`. The
        // branch, stored on the session, always uses the bare ref.
        const { ref } = withItemRef(db, userId, item);
        return json({
          session,
          ref,
          branch: session.branch,
          pr_title: workPrTitle(ref ?? "", item.title),
        });
      } catch (e) {
        return errorText(`${(e as Error).message} — no change was made.`);
      }
    },
  );

  server.registerTool(
    "report_work",
    {
      title: "Report work progress",
      description:
        "Tell the user where your work on an item has got to, in one short line (max 280 characters), " +
        "e.g. \"Opened the PR, waiting on CI\" or \"Blocked: need the API key for staging\". " +
        "It shows on the item and marks you as working; after about 15 minutes without a report you show as idle, " +
        "so report at each milestone rather than on a timer. Needs an open session from start_work. " +
        "item_id accepts the item's short ref (e.g. \"ENG-42\") or its internal id.",
      inputSchema: { item_id: z.string(), note: z.string().min(1) },
    },
    async ({ item_id, note }) => {
      const { db } = getDb();
      const { item, error } = resolveItemArg(db, userId, item_id);
      if (error) return error;
      try {
        return json(reportWork(db, userId, item.id, note, AGENT));
      } catch (e) {
        return errorText(`${(e as Error).message} — no change was made.`);
      }
    },
  );

  server.registerTool(
    "finish_work",
    {
      title: "Finish work on item",
      description:
        "End your work session on an item when the work ends without merging: its PR was closed, or you stopped or handed it back before opening one. " +
        "Don't call it when you open the PR or mark it ready for review: you stay on the item until the PR merges, and completing the item " +
        "(complete_item, or the GitHub webhook on merge) ends the session then. The webhook also ends it when the PR closes unmerged, unless another PR for the item is still open. " +
        "It takes you off the item's row and leaves the item open. note is an optional last line for the user, such as \"Closed in favour of #12\". " +
        "Returns the closed session, or null (a no-op) if you had no open session on it. " +
        "item_id accepts the item's short ref (e.g. \"ENG-42\") or its internal id.",
      inputSchema: { item_id: z.string(), note: z.string().optional() },
    },
    async ({ item_id, note }) => {
      const { db } = getDb();
      const { item, error } = resolveItemArg(db, userId, item_id);
      if (error) return error;
      try {
        return json(finishWork(db, userId, item.id, { note }, AGENT));
      } catch (e) {
        return errorText(`${(e as Error).message} — no change was made.`);
      }
    },
  );

  server.registerTool(
    "add_label",
    {
      title: "Add label",
      description:
        "Idempotently add a label to a list: an existing one with the name is returned as it is. " +
        "Items can also be given a new label by name in add_item or update_item, which adds it. " +
        "emoji is one emoji, or null for none, and is the user's choice; leave it out to get one suggested for the name.",
      inputSchema: {
        list_id: z.string(),
        name: z.string().min(1),
        emoji: z.string().nullable().optional(),
      },
    },
    async ({ list_id, name, emoji }) => {
      const { db } = getDb();
      if (!getProject(db, userId, list_id)) return notFound("list", list_id);
      if (emoji !== undefined) {
        return json(addLabel(db, userId, list_id, { name, emoji }, SOURCE));
      }
      const auto = await withAutoLabelEmoji(db, userId, list_id, [name]);
      const suggested = auto[name.trim()]?.emoji ?? null;
      return json(
        addLabel(db, userId, list_id, { name, emoji: suggested, emojiChosen: false }, SOURCE),
      );
    },
  );

  server.registerTool(
    "update_label",
    {
      title: "Update label",
      description:
        "Rename a label or change its emoji. A rename carries over to every item with the label. " +
        "emoji is one emoji, or null for none, and is the user's choice, which stays; " +
        "a label whose emoji nobody chose gets a new suggestion when renamed. id is the label's id from list_labels.",
      inputSchema: {
        id: z.string(),
        name: z.string().min(1).optional(),
        emoji: z.string().nullable().optional(),
      },
    },
    async ({ id, ...patch }) => {
      const { db } = getDb();
      if (!getLabel(db, userId, id)) return notFound("label", id);
      try {
        return json(updateLabel(db, userId, id, await withAutoLabelRename(db, userId, id, patch), SOURCE));
      } catch (e) {
        return errorText(`${(e as Error).message} — no change was made.`);
      }
    },
  );

  server.registerTool(
    "list_audit",
    {
      title: "List audit log",
      description:
        "Recent change history (newest first). Every create/update/complete/uncomplete/reorder/delete, and every agent's start/report/finish of work on an item, is logged with its source (web or mcp; system for a change nobody made, such as a repeating item reopening on its next due date), agentName (the API key name of the agent that made an mcp change) and a human summary. Each row includes `when`, a ready-to-display relative time (e.g. \"just now\", \"5 minutes ago\", \"7 months ago\") — show that to the user, not the raw `ts` epoch. Optionally filter by list_id or source.",
      inputSchema: {
        list_id: z.string().optional(),
        source: z.enum(AUDIT_SOURCES).optional(),
        limit: z.number().int().min(1).max(500).optional(),
      },
    },
    async ({ list_id, source, limit }) => {
      const { db } = getDb();
      const rows = listAudit(db, userId, {
        projectId: list_id,
        source,
        limit,
      });
      return json(
        rows.map(({ ts, entityType, ...rest }) => ({
          ts,
          when: formatRelativeLong(ts),
          entityType: entityType === "project" ? "list" : entityType,
          ...rest,
        })),
      );
    },
  );

  server.registerTool(
    "list_members",
    {
      title: "List list members",
      description:
        "List a list's collaborators and pending invites (the owner is not " +
        "included — it's the list's owner separately). Each row has user_id, " +
        "username, name, email, and status (\"accepted\" or \"pending\"). Use a " +
        "row's user_id with remove_member, or with update_item's assignee_ids.",
      inputSchema: { list_id: z.string() },
    },
    async ({ list_id }) => {
      const { db } = getDb();
      if (!getProject(db, userId, list_id)) {
        return notFound("list", list_id);
      }
      return json(listMembers(db, userId, list_id));
    },
  );

  server.registerTool(
    "invite_member",
    {
      title: "Invite a member",
      description:
        "Invite an existing user to collaborate on a list (owner only). " +
        "person is a username (\"alice\" or \"@alice\") or an email. The target " +
        "must already have an account — there is no invite-by-email-to-sign-up. " +
        "Lands a pending invite they must accept before they gain access; " +
        "accepted members can edit everything except owner-only actions " +
        "(delete, prefix, managing members).",
      inputSchema: { list_id: z.string(), person: z.string().min(1) },
    },
    async ({ list_id, person }) => {
      const { db } = getDb();
      const project = getProject(db, userId, list_id);
      if (!project) return notFound("list", list_id);
      const member = inviteMember(db, userId, list_id, person, SOURCE);
      await sendInviteNotification(db, ctx.baseUrl, userId, project.name, member.email);
      return json(member);
    },
  );

  server.registerTool(
    "remove_member",
    {
      title: "Remove a member",
      description:
        "Remove a collaborator or revoke a pending invite (owner only). " +
        "user_id is the value from list_members. To leave a list yourself, " +
        "use leave_list instead.",
      inputSchema: { list_id: z.string(), user_id: z.string() },
    },
    async ({ list_id, user_id }) => {
      const { db } = getDb();
      removeMember(db, userId, list_id, user_id, SOURCE);
      return json({ ok: true });
    },
  );

  server.registerTool(
    "list_pending_invites",
    {
      title: "List my pending invites",
      description:
        "List invites awaiting your response, to Spaces and to lists. " +
        "Returns { spaces, lists }: a Space invite has spaceId, spaceName and createdAt; " +
        "a list invite has listId, listName, ownerName and createdAt. " +
        "Accept with accept_invite or dismiss with decline_invite, passing a Space invite's spaceId as space_id " +
        "or a list invite's listId as list_id. Joining a Space shares every list in it with the user.",
      inputSchema: {},
    },
    async () => {
      const { db } = getDb();
      return json({
        spaces: listPendingSpaceInvites(db, userId),
        lists: listPendingInvites(db, userId),
      });
    },
  );

  server.registerTool(
    "accept_invite",
    {
      title: "Accept an invite",
      description:
        "Accept a pending invite, from list_pending_invites: pass space_id to join a Space " +
        "(gaining edit access to every list in it) or list_id to join one list. Pass exactly one.",
      inputSchema: { list_id: z.string().min(1).optional(), space_id: z.string().min(1).optional() },
    },
    async ({ list_id, space_id }) => {
      const { db } = getDb();
      if (space_id !== undefined && list_id === undefined) acceptSpaceInvite(db, userId, space_id, SOURCE);
      else if (list_id !== undefined && space_id === undefined) acceptInvite(db, userId, list_id, SOURCE);
      else return errorText("Pass exactly one of list_id or space_id — no change was made.");
      return json({ ok: true });
    },
  );

  server.registerTool(
    "decline_invite",
    {
      title: "Decline an invite",
      description:
        "Decline a pending invite, removing it: pass a Space invite's space_id or a list invite's " +
        "list_id, from list_pending_invites. Pass exactly one.",
      inputSchema: { list_id: z.string().min(1).optional(), space_id: z.string().min(1).optional() },
    },
    async ({ list_id, space_id }) => {
      const { db } = getDb();
      if (space_id !== undefined && list_id === undefined) declineSpaceInvite(db, userId, space_id, SOURCE);
      else if (list_id !== undefined && space_id === undefined) declineInvite(db, userId, list_id, SOURCE);
      else return errorText("Pass exactly one of list_id or space_id — no change was made.");
      return json({ ok: true });
    },
  );

  server.registerTool(
    "leave_list",
    {
      title: "Leave a list",
      description:
        "Remove yourself from a list you were invited to (you keep nothing). " +
        "The owner can't leave their own list — archive or delete it instead.",
      inputSchema: { list_id: z.string() },
    },
    async ({ list_id }) => {
      const { db } = getDb();
      removeMember(db, userId, list_id, userId, SOURCE);
      return json({ ok: true });
    },
  );

  // Spaces: a group of people who share every list in it. Every accepted
  // member sees and edits the Space's lists; admins also manage its people
  // and the Space itself. The core enforces the roles and the last-admin rule.
  const isJoined = (db: Db, spaceId: string) =>
    listSpaces(db, userId).some((s) => s.id === spaceId);

  server.registerTool(
    "list_spaces",
    {
      title: "List Spaces",
      description:
        "List the Spaces the user has joined, in the order their board shows them. A Space is a group of people who share every list in it. " +
        "Each has id, name, icon, color (null is grey) and the user's role: admin (manages its people and the Space itself) or member. " +
        "A list's spaceId (list_lists) says which Space it's in. Pending Space invites are in list_pending_invites.",
      inputSchema: {},
    },
    async () => {
      const { db } = getDb();
      return json(listSpaces(db, userId));
    },
  );

  server.registerTool(
    "create_space",
    {
      title: "Create Space",
      description:
        "Create a Space, such as \"Household\". The user becomes its only admin. " +
        "icon is optional: an emoji or an http(s) image URL. color is optional and tints the Space's lists on the board; leave it out for grey. " +
        "Then invite people with invite_space_member, and put lists in it with update_list's space_id or create_list's space_id.",
      inputSchema: {
        name: z.string().min(1),
        icon: z.string().optional(),
        color: z.enum(SPACE_COLORS).optional(),
      },
    },
    async ({ name, icon, color }) => {
      const { db } = getDb();
      return json(createSpace(db, userId, { name, icon, color }, SOURCE));
    },
  );

  server.registerTool(
    "update_space",
    {
      title: "Update Space",
      description:
        "Rename a Space or change its icon or colour (admins only). icon is an emoji or an http(s) image URL; " +
        "color tints the Space's lists on the board. Pass null to clear either (no colour is grey).",
      inputSchema: {
        space_id: z.string(),
        name: z.string().optional(),
        icon: z.string().nullable().optional(),
        color: z.enum(SPACE_COLORS).nullable().optional(),
      },
    },
    async ({ space_id, name, icon, color }) => {
      const { db } = getDb();
      if (!isJoined(db, space_id)) return notFound("space", space_id);
      updateSpace(db, userId, space_id, { name, icon, color }, SOURCE);
      return json(listSpaces(db, userId).find((s) => s.id === space_id));
    },
  );

  server.registerTool(
    "reorder_space",
    {
      title: "Reorder Space",
      description:
        "Move a Space on the user's board, among the Spaces they've joined; only their own board changes. " +
        "Their lists in no Space sit among them as a Personal group: pass space_id \"personal\" to move it, or use it as an anchor. " +
        "position is one of: start | end | after:<space_id> | before:<space_id>. " +
        "Returns the board's groups in their new order, as space ids and \"personal\".",
      inputSchema: { space_id: z.string(), position: ListPosRef },
    },
    async ({ space_id, position }) => {
      const { db } = getDb();
      if (space_id !== PERSONAL_TRAY && !isJoined(db, space_id)) return notFound("space", space_id);
      reorderSpace(db, userId, space_id, position, SOURCE);
      return json(listTrays(db, userId));
    },
  );

  server.registerTool(
    "delete_space",
    {
      title: "Delete Space",
      description:
        "Delete a Space (admins only). Its lists are kept: each goes back to its owner, still shared with anyone it was shared with directly, " +
        "and everyone else in the Space loses access to it. Confirm with the user before deleting.",
      inputSchema: { space_id: z.string() },
    },
    async ({ space_id }) => {
      const { db } = getDb();
      if (!isJoined(db, space_id)) return notFound("space", space_id);
      deleteSpace(db, userId, space_id, SOURCE);
      return json({ ok: true });
    },
  );

  server.registerTool(
    "list_space_members",
    {
      title: "List Space members",
      description:
        "List everyone in a Space and everyone invited to it, the user included. Each row has user_id, username, name, email, " +
        "status (\"accepted\" or \"pending\") and role (\"admin\" or \"member\"). " +
        "Use a row's user_id with remove_space_member or set_space_member_role, or with update_item's assignee_ids.",
      inputSchema: { space_id: z.string() },
    },
    async ({ space_id }) => {
      const { db } = getDb();
      if (!isJoined(db, space_id)) return notFound("space", space_id);
      return json(
        listSpaceMembers(db, userId, space_id).map(({ userId: user_id, ...m }) => ({ user_id, ...m })),
      );
    },
  );

  server.registerTool(
    "invite_space_member",
    {
      title: "Invite to a Space",
      description:
        "Invite an existing user to a Space (admins only). person is a username (\"alice\" or \"@alice\") or an email; " +
        "they must already have an account. They join as a member once they accept, and then see and edit every list in the Space, " +
        "so check with the user before inviting someone they didn't name.",
      inputSchema: { space_id: z.string(), person: z.string().min(1) },
    },
    async ({ space_id, person }) => {
      const { db } = getDb();
      const space = listSpaces(db, userId).find((s) => s.id === space_id);
      if (!space) return notFound("space", space_id);
      const member = inviteSpaceMember(db, userId, space_id, person, SOURCE);
      await sendInviteNotification(db, ctx.baseUrl, userId, space.name, member.email, "space");
      return json(member);
    },
  );

  server.registerTool(
    "remove_space_member",
    {
      title: "Remove from a Space",
      description:
        "Remove someone from a Space or revoke their pending invite (admins only). user_id comes from list_space_members. " +
        "They lose access to the Space's lists, except lists they own or were shared directly. " +
        "A Space always keeps an admin, so the last admin can't be removed. To leave a Space yourself, use leave_space.",
      inputSchema: { space_id: z.string(), user_id: z.string() },
    },
    async ({ space_id, user_id }) => {
      const { db } = getDb();
      if (!isJoined(db, space_id)) return notFound("space", space_id);
      removeSpaceMember(db, userId, space_id, user_id, SOURCE);
      return json({ ok: true });
    },
  );

  server.registerTool(
    "set_space_member_role",
    {
      title: "Set a Space member's role",
      description:
        "Make someone in a Space an admin, or a member again (admins only). user_id comes from list_space_members, " +
        "and they must have accepted. All admins are equal. A Space always keeps an admin, so the last admin can't be made a member.",
      inputSchema: {
        space_id: z.string(),
        user_id: z.string(),
        role: z.enum(SPACE_ROLES),
      },
    },
    async ({ space_id, user_id, role }) => {
      const { db } = getDb();
      if (!isJoined(db, space_id)) return notFound("space", space_id);
      setSpaceMemberRole(db, userId, space_id, user_id, role, SOURCE);
      return json({ ok: true });
    },
  );

  server.registerTool(
    "leave_space",
    {
      title: "Leave a Space",
      description:
        "Remove the user from a Space. They lose access to its lists, except lists they own (which stay in the Space) " +
        "or were shared directly. The last admin can't leave: make someone else an admin first, or delete the Space.",
      inputSchema: { space_id: z.string() },
    },
    async ({ space_id }) => {
      const { db } = getDb();
      if (!isJoined(db, space_id)) return notFound("space", space_id);
      removeSpaceMember(db, userId, space_id, userId, SOURCE);
      return json({ ok: true });
    },
  );
}
