import { listAccessById } from "@/core/access";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  type AgentOrigin,
  endAgentSession,
  finishWork,
  listOpenAgentSessions,
  listStartableAgents,
  listStartableLists,
  reportWork,
  requestWork,
  startWork,
  stopRequest,
} from "@/core/agentSessions";
import { sendAgentRequest } from "@/lib/agentRequest";
import { type AuditOrigin, listAudit } from "@/core/audit";
import {
  autoNewListIcon,
  withAutoLabelEmoji,
  withAutoLabelRename,
  withAutoListIcon,
} from "@/core/autoEmoji";
import { itemPriorities } from "@/core/autoPriority";
import {
  addComment,
  deleteComment,
  getComment,
  listComments,
  listRecentComments,
  mentionNotice,
  updateComment,
} from "@/core/comments";
import { plainText } from "@/core/describe";
import { addFeedbackFollowUp, submitFeedback } from "@/core/feedback";
import { setFollowing } from "@/core/follows";
import { FEEDBACK_KINDS } from "@/lib/feedback";
import {
  listNotificationLevels,
  listNotifications,
  markNotificationsRead,
  setNotificationLevel,
} from "@/core/notifications";
import {
  addLabel,
  deleteLabel,
  getLabel,
  labelUsage,
  type LabelUsage,
  listLabelUsage,
  listLabels,
  updateLabel,
} from "@/core/labels";
import { moveItem, previewMoveItem } from "@/core/move";
import { getDb } from "@/core/db";
import { addSmartMatch, getSmartDue, removeSmartMatch, setSmartRule } from "@/core/smartDue";
import { getTimeZone } from "@/core/users";
import { addFromSource, discardSource, getItemSource, getSource, proposeFromPhoto } from "@/core/sources";
import { nestItems } from "@/lib/itemTree";
import { projectRefPrefixes, resolveItemRef } from "@/core/itemRef";
import {
  acceptInvite,
  declineInvite,
  getUserName,
  inviteMember,
  setMemberRole,
  listCollaborators,
  listMembers,
  listPendingInvites,
  removeMember,
} from "@/core/members";
import {
  addItem,
  completeItem,
  deleteItem,
  getItem,
  listDoneBefore,
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
  LIST_ROLES,
  ONLY_WITHIN,
  type OnlyWithin,
  type ListRole,
  NOTIFICATION_LEVELS,
  type SpaceRole,
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
import { collaboratorAccess, invitePeople, type InvitePlace } from "@/core/invites";
import { getEnv } from "@/lib/env";
import { formatItemRef, workPrTitle } from "@/lib/itemRef";
import { askAboutDraft } from "@/lib/itemSuggest";
import {
  MAX_REPEAT_EVERY,
  REPEAT_ONS,
  REPEAT_UNITS,
  type RepeatOn,
  type RepeatUnit,
  nextDue,
  repeatOf,
} from "@/lib/repeat";
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
  on: z.enum(REPEAT_ONS).nullable().optional(),
  day: z.number().int().min(1).max(31).nullable().optional(),
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
    // add_item and update_item take: { every, unit, on?, day? }, or null. A finished
    // repeating item also says the day it comes back (the web's "Next: Tue").
    if ("repeatUnit" in obj && "repeatEvery" in obj) {
      const { repeatEvery, repeatUnit, repeatOn, repeatDay, ...rest } = obj;
      const repeat = repeatOf({
        repeatEvery: repeatEvery as number | null,
        repeatUnit: repeatUnit as RepeatUnit | null,
        repeatOn: repeatOn as RepeatOn | null | undefined,
        repeatDay: repeatDay as number | null | undefined,
      });
      obj = { ...rest, repeat };
      if (repeat && typeof obj.completedAt === "number") {
        const next = nextDue(dayOf(obj.completedAt, timeZone), repeat);
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

/** Where an item came from, for get_item. */
function photoOf(source: { sourceId: string; createdAt: number } | null) {
  return source && { source_id: source.sourceId, created_at: new Date(source.createdAt).toISOString() };
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
  role?: ListRole | SpaceRole,
  onlyMine?: boolean,
  within?: OnlyWithin | null,
) {
  if (!toEmail) return;
  await notifyInvite({
    to: toEmail,
    inviterName: getUserName(db, inviterId) ?? "Someone",
    projectName: name,
    url,
    kind,
    role,
    onlyMine,
    within,
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
        "spaceId is the Space the list is in (null for none); everyone in that Space can see it, and its admins and members can edit it. list_spaces gives each Space's name. " +
        "access is what the user can do on the list: edit, comment (see it and comment on its items, but change nothing else) or view (see it only). " +
        "Never try to change a list whose access isn't edit, or comment on one whose access is view: tell the user they can't instead.",
      inputSchema: { include_archived: z.boolean().optional() },
    },
    async ({ include_archived }) => {
      const { db } = getDb();
      const access = listAccessById(db, userId);
      return json(
        listProjects(db, userId)
          .filter((l) => include_archived || l.status !== "archived")
          .map((l) => ({ ...l, access: access.get(l.id) ?? "view" })),
      );
    },
  );

  server.registerTool(
    "get_list",
    {
      title: "Get list",
      description:
        "Fetch a list with its items in position order. Pass include_completed: true to also return completed items. Works for archived lists too. " +
        "A repeating item carries `repeat` ({ every, unit, on?, day? }); a finished one also carries `comesBack`, the day it reopens. ",
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
        "- A repeating item carries `repeat` ({ every, unit, on?, day? }); a finished one also carries `comesBack`, the day it reopens. Mark a repeating item with its rule, e.g. `├── Water plants (every 3 days)` or `├── Clean the car (every 2 weeks on weekends)`.",
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
        "What's due now on the user's Brief view: items across their active lists (not archived) that are due today or overdue, " +
        "items due in a span that has started (dueFrom on or before today, e.g. due this week from Monday), " +
        "plus items finished today, which the user sees crossed out. Overdue items come first, then by board order. " +
        "The user sees them under Overdue (dueDate before today), Today (due today alone) and This week (a span under way); " +
        "their Brief also shows what's due later, under Tomorrow, This week, Next week and Later, which this tool leaves out. " +
        "Returns { today, timeZone, items }, plus a note when the timezone is a UTC fallback. today is the user's current day (YYYY-MM-DD) in timeZone, which their browser reports; " +
        "the day turns over at 4am, so at 1am it's still the day before. Use today to work out dates like tomorrow for due_date. " +
        "Each item carries its ref, listName and, for a sub-item, parentTitle. " +
        "Items carry assigneeIds, everyone they're assigned to; a joint item has several. " +
        "filter narrows to items assigned to the user, alone or jointly with others (mine), " +
        "assigned only to other people (theirs), or to nobody (unassigned). Every item falls under exactly one of the three.\n" +
        "A repeating item carries `repeat` ({ every, unit, on?, day? }); a finished one also carries `comesBack`, the day it reopens. " +
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
        "The No date section of the user's Brief view: tasks with no due date across their active lists (not archived), " +
        "for planning when to do them. Sub-items of a dated parent are left out, since they are planned with their parent. " +
        "Items finished today are included, which the user sees crossed out. " +
        "Returns { today, timeZone, lists }, plus a note when the timezone is a UTC fallback; today works as in list_today. " +
        "lists is in board order, each { list, items } with items in list order and an undated parent's undated sub-items nested in children; " +
        "lists with nothing undated are left out. A sub-item whose parent isn't shown carries parentTitle. " +
        "Items carry assigneeIds, everyone they're assigned to; a joint item has several. " +
        "filter narrows to items assigned to the user, alone or jointly with others (mine), " +
        "assigned only to other people (theirs), or to nobody (unassigned), as in list_today.\n" +
        "A repeating item carries `repeat` ({ every, unit, on?, day? }); a finished one also carries `comesBack`, the day it reopens. " +
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
    "clear_done",
    {
      title: "Clear done items",
      description:
        "Move a list's finished items into Done now, as the list's Clear done does, instead of when the day turns over. " +
        "They stay finished and searchable (search_done); only where the board shows them changes. Returns the list.",
      inputSchema: { id: z.string() },
    },
    async ({ id }) => {
      const { db } = getDb();
      if (!getProject(db, userId, id)) return notFound("list", id);
      return json(updateProject(db, userId, id, { doneClearedAt: Date.now() }, SOURCE));
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
        "A repeating item carries `repeat` ({ every, unit, on?, day? }); a finished one also carries `comesBack`, the day it reopens. " +
        "`agents` lists the agents working on it now (open start_work sessions: agentName, threadUrl, note, lastActiveAt); " +
        "check it before starting work so you don't duplicate another agent's. " +
        "`smart` is set when its due date is smart (set_smart_due): its rule, lead and matches, the one its date comes from marked current. " +
        "`fromPhoto` is set when it was added from a photo with add_from_photo: { source_id, created_at }. " +
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
        fromPhoto: photoOf(getItemSource(db, userId, item.id)),
        ...(item.smartRule !== null && { smart: getSmartDue(db, userId, item.id) }),
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
    "update_comment",
    {
      title: "Edit comment",
      description:
        "Rewrite a comment the user wrote, or an agent wrote for them: body replaces its text (Markdown) and it shows as edited. " +
        "id is the comment's id, from get_item's comments or list_recent_comments. Only the comment's author can edit it. " +
        "Anyone the new text @mentions who the old text didn't is emailed it, as with add_comment. " +
        `Max ${COMMENT_MAX} characters. Returns the comment.`,
      inputSchema: { id: z.string(), body: z.string().min(1) },
    },
    async ({ id, body }) => {
      const { db } = getDb();
      const before = getComment(db, userId, id)?.body;
      let comment;
      try {
        comment = updateComment(db, userId, id, body, SOURCE);
      } catch (e) {
        return errorText(`${(e as Error).message} — no change was made.`);
      }
      const notice = mentionNotice(db, userId, comment, before);
      if (notice) {
        await notifyMentions(notice, ctx.baseUrl);
      }
      return json(comment);
    },
  );

  server.registerTool(
    "delete_comment",
    {
      title: "Delete comment",
      description:
        "Delete a comment the user wrote, or an agent wrote for them, from its item. Only the comment's author can. " +
        "Its words are gone for good, though the activity log keeps that it was deleted and by which agent, " +
        "so delete only what the user asked you to, and edit with update_comment when they only want it corrected. " +
        "id is the comment's id, from get_item's comments or list_recent_comments. Returns { deleted: true }.",
      inputSchema: { id: z.string() },
    },
    async ({ id }) => {
      const { db } = getDb();
      try {
        deleteComment(db, userId, id, SOURCE);
      } catch (e) {
        return errorText(`${(e as Error).message} — no change was made.`);
      }
      return json({ deleted: true });
    },
  );

  server.registerTool(
    "list_recent_comments",
    {
      title: "List recent comments",
      description:
        "The newest comments across the items the user can open, newest first, to catch up on discussion without opening each item. " +
        "list_id narrows to one list. limit is how many (default 50, max 500). " +
        "Each is a comment as in get_item (body, author, agentName, createdAt, editedAt) plus `item`: the item it's on, with its id, title, ref and completedAt. " +
        "Show each with its item's ref and title, who wrote it and when.",
      inputSchema: {
        list_id: z.string().optional(),
        limit: z.number().int().min(1).max(500).optional(),
      },
    },
    async ({ list_id, limit }) => {
      const { db } = getDb();
      if (list_id && !getProject(db, userId, list_id)) return notFound("list", list_id);
      const refs = projectRefPrefixes(db, userId);
      return json(
        listRecentComments(db, userId, { projectId: list_id, limit }).map((c) => ({
          ...c,
          item: { ...c.item, ref: formatItemRef(refs[c.item.projectId] ?? "", c.item.number) },
        })),
      );
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
        "assignee_ids assigns it to one or more people, each the list owner (the list's userId) or an accepted member who can edit it " +
        "(user_id from list_members), or \"me\" for the user you act for; several make a joint item. " +
        "assignee_id (one id) also works, for older prompts; don't pass both. " +
        "completed: true creates it already done, in one call — use it when the user tells you about something they've finished, " +
        "instead of add_item then complete_item. " +
        "repeat makes a task come round again: { every, unit, on?, day? } with unit day, week or month, e.g. { every: 3, unit: \"day\" } for every 3 days. " +
        "The next due date counts from the day it was last completed, not a fixed calendar: completing it leaves it crossed out for the rest of the day, " +
        "then on the day `every` units after the day it was done it reopens as the same item (same ref), due that day. " +
        "Its due date is only for this time: it comes back due on that one day, whatever it was due before. " +
        "To keep a weekly or monthly task to certain days, set on: a weekday (mon to sun) or weekend, " +
        "only when the user says so (\"every 2 weeks on weekends\", \"every Saturday\"; not just because it's due this weekend). " +
        "It then comes back on the first of those days from the day `every` units after it was done, or that weekend from its Saturday, " +
        "so { every: 2, unit: \"week\", on: \"weekend\" } done three days late on a Wednesday is due the weekend after the Wednesday two weeks on. " +
        "A month later keeps the day of the month, or the month's last day when that's shorter. " +
        "To keep a monthly task to a fixed day of the month instead, set day (1 to 31, not with on), " +
        "when the user names one (\"on the 1st of every month\", \"rent on the 28th\"): it then comes back on the next of that day after it's done, " +
        "however early or late, then `every` - 1 months on, so { every: 1, unit: \"month\", day: 1 } done on 21 November is due 1 December. " +
        "A month without that day (29 to 31) uses its last day. " +
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
        ? await askAboutDraft(
            { title: created.title, description: created.description ?? "" },
            { items: before.map((it) => ({ id: it.id, title: it.title, topLevel: false })) },
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
    "add_from_photo",
    {
      title: "Add these to Sidetrack",
      description:
        "When the user shares a photo of a list (a notebook page, a whiteboard, a note on the fridge) and wants it in Sidetrack, " +
        "read it yourself and propose a line per item; nothing goes on the board until the user reviews the lines in the app, where they can change any of them. " +
        "So don't stop to ask: make your best reading and let the review catch the rest. Before proposing, get_list or list_all_items to match lines to items that already exist. " +
        "Reading a page: a struck-through line is done; an underlined heading with lines under it is a task with those lines as its sub-items (parent: the heading's index); " +
        "a heading such as \"Buy\" over a group may name a list instead, so file its lines there (or label them, e.g. labels: [\"buy\"]). Skip doodles. " +
        "A line made to stand out (circled, boxed, starred, arrowed) matters more: give it a near due date, today or in the next few days, unless the user has told you what their marks mean; " +
        "follow what they've told you over this (e.g. their \">\" might mean it's already in Sidetrack, so match it). " +
        "Each line: title (as written, spelling fixed), list_id, and optionally parent (index of an earlier line, for a sub-item), " +
        "parent_item (ref of an existing task to add it under), done, due_date, labels, repeat ({ every, unit, on?, day? } as in add_item, for \"every Sunday\" and the like), " +
        "assignee_ids (\"me\" for the user, or people on the list), and match: the ref of an existing item this line is. " +
        "A matched line changes that item if the page says something new: done: true ticks it off, due_date, repeat and assignee_ids replace its own, labels are added; " +
        "leave them out to leave it as it is (it still links to the photo). " +
        "region is where the line is on the photo, so the user sees the handwriting next to each line: { x, y, w, h } as fractions (0 to 1) of the photo's width and height from its top-left, " +
        "the box around the words as if level, and angle: degrees it's turned clockwise about its centre, for a line written on a slant. " +
        "Skip struck-through lines that aren't in Sidetrack yet, unless they're steps in a checklist (keep those as done so its count is right). " +
        "note is shown above the lines: say anything the user should check, e.g. a word you couldn't read or what you took a mark to mean. They can't reply to it, so don't ask questions there. " +
        "Returns { source_id, upload, review_url }: then upload the photo with the command in upload.curl (a PUT of the image file: JPEG, PNG or WebP, at most 15 MB, within an hour; " +
        "convert HEIC first). Never put the photo's bytes in a tool call. Then give the user review_url, where they check the lines against the photo and add them.",
      inputSchema: {
        note: z.string().optional(),
        lines: z
          .array(
            z.object({
              title: z.string().min(1),
              list_id: z.string(),
              parent: z.number().int().min(0).optional(),
              parent_item: z.string().optional(),
              match: z.string().optional(),
              done: z.boolean().optional(),
              due_date: DueDate.optional(),
              labels: z.array(z.string()).optional(),
              repeat: Repeat.optional(),
              assignee_ids: z.array(z.string().min(1)).optional(),
              region: z
                .object({
                  x: z.number(),
                  y: z.number(),
                  w: z.number(),
                  h: z.number(),
                  angle: z.number().optional(),
                })
                .optional(),
            }),
          )
          .min(1),
      },
    },
    async ({ note, lines }) => {
      const { db } = getDb();
      const proposed = [];
      for (const line of lines) {
        const resolve = (ref: string | undefined) => (ref ? resolveItemArg(db, userId, ref) : null);
        const parentItem = resolve(line.parent_item);
        if (parentItem?.error) return parentItem.error;
        const match = resolve(line.match);
        if (match?.error) return match.error;
        proposed.push({
          title: line.title,
          projectId: line.list_id,
          parent: line.parent,
          parentItemId: parentItem?.item.id,
          matchItemId: match?.item.id,
          done: line.done,
          dueDate: line.due_date,
          labels: line.labels,
          repeat: line.repeat,
          assigneeIds: line.assignee_ids?.map((a) => (a === "me" ? userId : a)),
          region: line.region,
        });
      }
      let proposal: ReturnType<typeof proposeFromPhoto>;
      try {
        proposal = proposeFromPhoto(db, userId, { note, lines: proposed }, ctx.agent.name);
      } catch (e) {
        return errorText(`${e instanceof Error ? e.message : String(e)} — nothing was saved.`);
      }
      const url = `${ctx.baseUrl}/api/sources/upload/${proposal.uploadToken}`;
      return json({
        source_id: proposal.sourceId,
        upload: {
          method: "PUT",
          url,
          curl: `curl --fail-with-body -T <path-to-photo> '${url}'`,
          expires_at: new Date(proposal.expiresAt).toISOString(),
        },
        review_url: `${ctx.baseUrl}/sources/${proposal.sourceId}`,
      });
    },
  );

  server.registerTool(
    "add_photo_lines",
    {
      title: "Add a photo's lines",
      description:
        "Add every line proposed with add_from_photo to the board as proposed, without the user reviewing them in the app: " +
        "only when the user tells you to (e.g. \"just add them\"); otherwise give them the review_url. " +
        "To change a line first, discard_photo and propose again. The photo must be uploaded. " +
        "Returns { added, updated, completed, skipped }.",
      inputSchema: { source_id: z.string() },
    },
    async ({ source_id }) => {
      const { db } = getDb();
      const found = getSource(db, userId, source_id);
      if (!found) return notFound("photo", source_id);
      try {
        const reviews = found.lines.map((line) => ({ id: line.id, add: true }));
        return json(addFromSource(db, userId, source_id, reviews, SOURCE));
      } catch (e) {
        return errorText(`${e instanceof Error ? e.message : String(e)} — nothing was added.`);
      }
    },
  );

  server.registerTool(
    "discard_photo",
    {
      title: "Discard a photo",
      description:
        "Drop a photo proposed with add_from_photo that hasn't been added, with its lines, e.g. to propose them again after reading it wrong. " +
        "Nothing on the board changes. Returns { discarded }, false when it was already added or discarded.",
      inputSchema: { source_id: z.string() },
    },
    async ({ source_id }) => {
      const { db } = getDb();
      return json({ discarded: discardSource(db, userId, source_id) });
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
        "or an accepted member who can edit it (from list_members), or \"me\" for the user you act for. [] unassigns everyone. " +
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
        "repeat sets how often a task comes round again, { every, unit, on?, day? } (see add_item); pass null to stop it repeating. " +
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

  // The item, with its ref, and its smart due date's rule and matches.
  const smartResult = (id: string) => {
    const { db } = getDb();
    const it = getItem(db, userId, id);
    return json({ item: it && withItemRef(db, userId, it), smart: getSmartDue(db, userId, id) });
  };

  server.registerTool(
    "set_smart_due",
    {
      title: "Set a smart due date",
      description:
        "Make an item due relative to something not known yet, in the user's words: \"before our next trip\", \"before Mum's birthday\". " +
        "Use it when the user ties a deadline to another thing rather than a day; for a day or week, set due_date with update_item instead. " +
        "lead is how many days before the match it's due (0 on the day, 7 for a week before). " +
        "Its due date is then worked out by Sidetrack, never set: the earliest first day of its matches that are open and dated, lead days before. " +
        "With no match it has no date, so add the item it hangs off with add_smart_match (find it with list_all_items). " +
        "The date then follows that item by itself: moved, finished or deleted, it's worked out again from the rest. " +
        "rule null makes it a plain due date again, keeping the date it has; setting due_date with update_item does the same. " +
        "A repeating item can't have one yet. id accepts the item's short ref (e.g. \"HOM-12\") or its internal id. " +
        "Returns { item, smart }: smart has rule, lead and matches (each with title, ref, due, reason, and current: the one its date comes from). " +
        "Tell the user the date it worked out and which match it comes from, or that it's waiting for one.",
      inputSchema: {
        id: z.string(),
        rule: z.string().max(200).nullable(),
        lead: z.number().int().min(0).max(365).optional(),
      },
    },
    async ({ id, rule, lead }) => {
      const { db } = getDb();
      const { item, error } = resolveItemArg(db, userId, id);
      if (error) return error;
      setSmartRule(db, userId, item.id, rule === null ? null : { rule, lead: lead ?? item.smartLead ?? 0 }, SOURCE);
      return smartResult(item.id);
    },
  );

  server.registerTool(
    "add_smart_match",
    {
      title: "Add a match to a smart due date",
      description:
        "Say which item a smart due date (set_smart_due) hangs off: \"Lisbon flights\" for \"before our next trip\". " +
        "Match only items that really fit the rule; reason says why in a few words (\"a trip\"), shown to the user. " +
        "Its date is worked out again at once. A match the user removed before comes back, so don't add one they removed unless they ask. " +
        "id and anchor_id accept short refs or internal ids. Returns { item, smart } like set_smart_due.",
      inputSchema: { id: z.string(), anchor_id: z.string(), reason: z.string().max(100).optional() },
    },
    async ({ id, anchor_id, reason }) => {
      const { db } = getDb();
      const { item, error } = resolveItemArg(db, userId, id);
      if (error) return error;
      const anchor = resolveItemArg(db, userId, anchor_id);
      if (anchor.error) return anchor.error;
      addSmartMatch(db, userId, item.id, anchor.item.id, reason ?? null, SOURCE);
      return smartResult(item.id);
    },
  );

  server.registerTool(
    "remove_smart_match",
    {
      title: "Remove a match from a smart due date",
      description:
        "Say an item isn't a match for a smart due date after all (\"Trip to B&Q\" isn't a trip). " +
        "It stops counting and is remembered as removed, and the date is worked out again from the rest. " +
        "id and anchor_id accept short refs or internal ids; a match in a list the user can't open has no ref, so pass its anchorId from smart.matches. " +
        "Returns { item, smart } like set_smart_due.",
      inputSchema: { id: z.string(), anchor_id: z.string() },
    },
    async ({ id, anchor_id }) => {
      const { db } = getDb();
      const { item, error } = resolveItemArg(db, userId, id);
      if (error) return error;
      // A match in a list they can't open is still theirs to remove, by its id.
      const anchor = resolveItemArg(db, userId, anchor_id);
      const anchorId = anchor.error ? anchor_id : anchor.item.id;
      if (!getSmartDue(db, userId, item.id)?.matches.some((m) => m.anchorId === anchorId)) {
        return errorText(`${anchor_id} isn't one of ${id}'s matches — no change was made.`);
      }
      removeSmartMatch(db, userId, item.id, anchorId, SOURCE);
      return smartResult(item.id);
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
        "A repeating item (one with a repeat rule) reopens by itself on its next due date: `every` units after the day it was completed (then its rule's next weekday or weekend, if it has `on`), or, with `day`, the next of that day of the month. " +
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
        "\"created\" (date created, newest first), \"title\" (A to Z) " +
        "or \"priority\" (most important or urgent first, as an AI model judges each open item against the rest of the list; done items last). " +
        "Items that tie keep their current order, and sub-items move with their parent. " +
        "A priority sort fails, changing nothing, when AI suggestions are off or unavailable. " +
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
      const priority = by === "priority" ? await itemPriorities(db, userId, list_id) : undefined;
      if (priority === null) {
        return errorText(
          "Couldn't rank the items by priority: AI suggestions are off or unavailable right now — no change was made.",
        );
      }
      const changed = sortItems(db, userId, list_id, by, SOURCE, priority) !== null;
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
        "otherwise it's suggested for the name and follows renames. " +
        "A label with archivedAt set is archived: it stays on the items that have it, but don't offer it for new ones. " +
        "With include_usage, each label also has usage: { active, done }, how many open and done items it's on, as List details shows; " +
        "use it to find labels nobody uses before tidying them up.",
      inputSchema: { list_id: z.string(), include_usage: z.boolean().optional() },
    },
    async ({ list_id, include_usage }) => {
      const { db } = getDb();
      const labels = listLabels(db, userId, list_id);
      if (!include_usage) return json(labels);
      const usage = listLabelUsage(db, userId, list_id);
      return json(
        labels.map((l) => ({
          ...l,
          usage: { active: usage[l.id]?.active.length ?? 0, done: usage[l.id]?.done.length ?? 0 },
        })),
      );
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

  // Assigning agents: what the board's assignee picker does for the user's
  // own agents, with the same rules (core's requestWork and stopRequest).
  server.registerTool(
    "list_agents",
    {
      title: "List agents",
      description:
        "The user's agents that Sidetrack can start: API keys set (in Settings → API keys) to start work when assigned. " +
        "Returns { agents, listIds }: agents are { keyId, name }, and listIds are the lists the user can start them on, " +
        "the ones they're admin of (owner of a personal list, or admin of its Space) that have a repository. " +
        "Pass an agent's keyId to assign_agent or unassign_agent.",
      inputSchema: {},
    },
    async () => {
      const { db } = getDb();
      return json({
        agents: listStartableAgents(db, userId),
        listIds: listStartableLists(db, userId),
      });
    },
  );

  server.registerTool(
    "assign_agent",
    {
      title: "Assign agent",
      description:
        "Assign one of the user's agents (agent_key_id from list_agents) to an item, as the board's assignee picker does: " +
        "Sidetrack asks the agent's webhook to start work on it in the list's repository, and the agent shows on the item at once. " +
        "Only the list's admin can, and only on a list with a repository; refused for a completed item. " +
        "People's assignments are left alone. Assigning an agent already on the item changes nothing. " +
        "If its webhook can't be reached, the agent comes off again and this returns an error. " +
        "Returns the agent's session. item_id accepts the item's short ref (e.g. \"ENG-42\") or its internal id.",
      inputSchema: { item_id: z.string(), agent_key_id: z.string() },
    },
    async ({ item_id, agent_key_id }) => {
      const { db } = getDb();
      const { item, error } = resolveItemArg(db, userId, item_id);
      if (error) return error;
      let started;
      try {
        started = requestWork(db, userId, item.id, agent_key_id, SOURCE);
      } catch (e) {
        return errorText(`${(e as Error).message} — no change was made.`);
      }
      if (started.request) {
        try {
          await sendAgentRequest(started.request);
        } catch (e) {
          const reason = (e as Error).message;
          endAgentSession(db, userId, started.session.id, SOURCE, reason);
          return errorText(`${reason}, so the agent wasn't started.`);
        }
      }
      return json(started.session);
    },
  );

  server.registerTool(
    "unassign_agent",
    {
      title: "Unassign agent",
      description:
        "Take one of the user's agents (agent_key_id, as in the item's `agents` from get_item) off an item, as unassigning it on the board does: " +
        "Sidetrack tells the agent's webhook to stop, then ends its session there. Works whether or not the user is the list's admin. " +
        "If the webhook can't be reached, the agent stays on the item and this returns an error, so you can try again. " +
        "Returns { stopped: true }, or { stopped: false } (a no-op) when that agent wasn't on the item. " +
        "item_id accepts the item's short ref (e.g. \"ENG-42\") or its internal id.",
      inputSchema: { item_id: z.string(), agent_key_id: z.string() },
    },
    async ({ item_id, agent_key_id }) => {
      const { db } = getDb();
      const { item, error } = resolveItemArg(db, userId, item_id);
      if (error) return error;
      let found;
      try {
        found = stopRequest(db, userId, item.id, agent_key_id);
      } catch (e) {
        return errorText(`${(e as Error).message} — no change was made.`);
      }
      if (!found) return json({ stopped: false });
      if (found.request) {
        try {
          await sendAgentRequest(found.request);
        } catch (e) {
          return errorText(`${(e as Error).message}, so the agent is still on the item.`);
        }
      }
      endAgentSession(db, userId, found.session.id, SOURCE);
      return json({ stopped: true });
    },
  );

  server.registerTool(
    "search_done",
    {
      title: "Search done items",
      description:
        "Items the user finished, across their lists that aren't archived, newest first: for questions like \"when did I last do X?\". " +
        "query keeps only those whose title contains it or whose ref it is (e.g. \"HOM-12\"). " +
        "before (epoch ms, default now) and limit (default 50, max 200) page back: pass the previous result's `since` as before for older ones. " +
        "Returns { items, since, more }: items each with its ref, listName and completedAt, plus the rest of its group (its parent and their sub-items) " +
        "so checklists are whole; more is true when older ones remain. Show each with its list name and when it was finished.",
      inputSchema: {
        query: z.string().optional(),
        before: z.number().int().nonnegative().optional(),
        limit: z.number().int().min(1).max(200).optional(),
      },
    },
    async ({ query, before, limit }) => {
      const { db } = getDb();
      const found = listDoneBefore(db, userId, {
        before: before ?? Date.now(),
        limit: limit ?? 50,
        query,
      });
      const refs = projectRefPrefixes(db, userId);
      const names = new Map(listProjects(db, userId).map((p) => [p.id, p.name]));
      return json({
        ...found,
        items: found.items.map((it) => ({
          ...it,
          ref: formatItemRef(refs[it.projectId] ?? "", it.number),
          listName: names.get(it.projectId) ?? null,
        })),
      });
    },
  );

  // Notifications are the user's own: following, levels and read state are
  // per person and seen by nobody else, so core doesn't audit them.
  server.registerTool(
    "follow_item",
    {
      title: "Follow or unfollow item",
      description:
        "Follow an item (following: true) so the user hears about its activity, or unfollow it (false) so they stop. " +
        "People follow items they create, are assigned to, comment on or are mentioned on automatically; an unfollow sticks, " +
        "and following a parent covers its sub-items. Use it when the user asks to be kept posted on an item, or to stop hearing about one. " +
        "item_id accepts the item's short ref (e.g. \"ENG-42\") or its internal id. Returns { following }.",
      inputSchema: { item_id: z.string(), following: z.boolean() },
    },
    async ({ item_id, following }) => {
      const { db } = getDb();
      const { item, error } = resolveItemArg(db, userId, item_id);
      if (error) return error;
      setFollowing(db, userId, item.id, following);
      return json({ following });
    },
  );

  server.registerTool(
    "list_notifications",
    {
      title: "List notifications",
      description:
        "The user's notifications inbox, newest first: everything unseen, then their latest seen ones. " +
        "Each has id, text (the sentence, as the inbox shows it), snippet (a quoted comment or note, or null), title (the list or Space), " +
        "itemRef when it's about an item, when (relative, e.g. \"5 minutes ago\"; show that, not createdAt), readAt (null when unseen) and agentName when an agent made the change. " +
        "levels is how much they hear about each scope they've set (see set_notification_level). " +
        "Show the unseen ones first, then mark them seen with mark_notifications_read only if the user asks.",
      inputSchema: {},
    },
    async () => {
      const { db } = getDb();
      const today = dayOf(Date.now(), getTimeZone(db, userId) ?? "UTC");
      return json({
        notifications: listNotifications(db, userId).map((n) => ({
          id: n.id,
          reason: n.reason,
          text: plainText(n.parts, today),
          snippet: n.snippet,
          title: n.title,
          ...(n.itemRef ? { itemRef: n.itemRef } : {}),
          when: formatRelativeLong(n.createdAt),
          createdAt: n.createdAt,
          readAt: n.readAt,
          agentName: n.agentName,
        })),
        levels: listNotificationLevels(db, userId),
      });
    },
  );

  server.registerTool(
    "mark_notifications_read",
    {
      title: "Mark notifications seen",
      description:
        "Mark the user's notifications seen: ids (from list_notifications) for those, or leave ids out for all of them. " +
        "Do it only when the user asks. Returns { ok: true }.",
      inputSchema: { ids: z.array(z.string().min(1)).optional() },
    },
    async ({ ids }) => {
      const { db } = getDb();
      markNotificationsRead(db, userId, ids);
      return json({ ok: true });
    },
  );

  server.registerTool(
    "set_notification_level",
    {
      title: "Set notification level",
      description:
        "Set how much the user hears about a scope, as in Settings → Notifications. scope is \"all\" (everything), " +
        "\"space:<space id>\" or \"list:<list id>\" for one they're in (the most specific one set wins), " +
        "\"reminders\" for due reminders, or \"agents\" for what isn't a person's doing (other people's agents, GitHub, Sidetrack itself). " +
        "level is all (push everything), default (push what's aimed at them or what they follow; the rest goes to the inbox only) " +
        "or mine (only what's aimed at them); null goes back to what the scope inherits. " +
        "For reminders, all pushes them, default keeps them to the inbox and mine turns them off; " +
        "for agents, all hears them like people's changes, default keeps them to the inbox and mine keeps only what's aimed at the user. " +
        "Change it only when the user asks, and tell them what they'll now hear. Returns { levels }, every scope they've set.",
      inputSchema: {
        scope: z.string().min(1),
        level: z.enum(NOTIFICATION_LEVELS).nullable(),
      },
    },
    async ({ scope, level }) => {
      const { db } = getDb();
      try {
        setNotificationLevel(db, userId, scope, level);
      } catch (e) {
        return errorText(`${(e as Error).message} — no change was made.`);
      }
      return json({ levels: listNotificationLevels(db, userId) });
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

  // A label's usage for an agent: each item with its display ref.
  const usageForAgent = (projectId: string, u: LabelUsage) => {
    const prefix = projectRefPrefixes(getDb().db, userId)[projectId] ?? "";
    const shape = (it: LabelUsage["active"][number]) => ({
      id: it.id,
      ref: formatItemRef(prefix, it.number),
      title: it.title,
    });
    return { active: u.active.map(shape), done: u.done.map(shape) };
  };

  server.registerTool(
    "update_label",
    {
      title: "Update label",
      description:
        "Rename a label, change its emoji, or archive or restore it. A rename carries over to every item with the label. " +
        "emoji is one emoji, or null for none, and is the user's choice, which stays; " +
        "a label whose emoji nobody chose gets a new suggestion when renamed. " +
        "archived: true archives it: it stays on the items that have it, but isn't offered for new ones; false puts it back in use. " +
        "Returns the label and usedOn: the items it's on, active (open) and done, each with its ref and title. " +
        "Tell the user which items the change touched: list the active ones, and give the done ones as a count unless they ask. " +
        "id is the label's id from list_labels.",
      inputSchema: {
        id: z.string(),
        name: z.string().min(1).optional(),
        emoji: z.string().nullable().optional(),
        archived: z.boolean().optional(),
      },
    },
    async ({ id, ...patch }) => {
      const { db } = getDb();
      if (!getLabel(db, userId, id)) return notFound("label", id);
      try {
        const label = updateLabel(db, userId, id, await withAutoLabelRename(db, userId, id, patch), SOURCE);
        const usage = labelUsage(db, userId, id);
        return json({ label, usedOn: usage && usageForAgent(label.projectId, usage) });
      } catch (e) {
        return errorText(`${(e as Error).message} — no change was made.`);
      }
    },
  );

  server.registerTool(
    "delete_label",
    {
      title: "Delete label",
      description:
        "Delete a label from its list and take it off every item that has it. To keep it on its items but stop offering it, archive it with update_label instead. " +
        "Call it first without token: that only previews and changes nothing. It returns the label and usedOn: the items it's on, " +
        "active (open) and done, each with its ref and title, and a token. " +
        "Show the user the label and its active items, with the done ones as a count, and ask them to confirm the delete; mention archiving as the alternative. " +
        "Then call again with that token. The delete is refused if the items it's on have changed since: then preview again and show the user the new one. " +
        "Never pass the token for a delete the user hasn't seen and agreed to. id is the label's id from list_labels.",
      inputSchema: { id: z.string(), token: z.string().optional() },
    },
    async ({ id, token }) => {
      const { db } = getDb();
      const label = getLabel(db, userId, id);
      const usage = labelUsage(db, userId, id);
      if (!label || !usage) return notFound("label", id);
      const usedOn = usageForAgent(label.projectId, usage);
      if (token === undefined) {
        return json({ deleted: false, label, usedOn, token: usage.token });
      }
      try {
        deleteLabel(db, userId, id, token, SOURCE);
        return json({ deleted: true, label, usedOn });
      } catch (e) {
        return errorText(`${(e as Error).message} — no change was made.`);
      }
    },
  );

  // Feedback goes to the deployment's feedback list (FEEDBACK_LIST_ID), which
  // the user usually can't open: they can add to it, never read it.
  server.registerTool(
    "send_feedback",
    {
      title: "Send feedback",
      description:
        "Send feedback about Sidetrack itself to the people who run it, as the app's Send feedback does: a bug, an idea, or other. " +
        "Use it when the user asks you to report a problem or suggest something, in their words; " +
        "say what they were doing and what happened, and send it only once they've agreed to what it says. " +
        "message is Markdown; its first line becomes the title. It's filed under the user's name, noting that you sent it. " +
        "The user can't open it afterwards, so tell them its ref. Within 30 minutes, add_to_feedback can add to it once. " +
        "At most 5 an hour. Returns { itemId, ref }.",
      inputSchema: { kind: z.enum(FEEDBACK_KINDS), message: z.string().min(1) },
    },
    async ({ kind, message }) => {
      const listId = getEnv().FEEDBACK_LIST_ID;
      if (!listId) return errorText("This Sidetrack doesn't take feedback — no change was made.");
      const { db } = getDb();
      try {
        return json(submitFeedback(db, userId, { listId, kind, message }, SOURCE));
      } catch (e) {
        return errorText(`${(e as Error).message} — no change was made.`);
      }
    },
  );

  server.registerTool(
    "add_to_feedback",
    {
      title: "Add to feedback",
      description:
        "Add more to feedback the user sent in the last 30 minutes, as a Follow-up section: something they remembered, or an answer. " +
        "Once per piece of feedback. item_id is the itemId send_feedback returned (not its ref, which the user can't open). Returns { ok: true }.",
      inputSchema: { item_id: z.string().min(1), note: z.string().min(1) },
    },
    async ({ item_id, note }) => {
      const listId = getEnv().FEEDBACK_LIST_ID;
      if (!listId) return errorText("This Sidetrack doesn't take feedback — no change was made.");
      const { db } = getDb();
      try {
        addFeedbackFollowUp(db, userId, { listId, itemId: item_id, answers: [], note }, SOURCE);
      } catch (e) {
        return errorText(`${(e as Error).message} — no change was made.`);
      }
      return json({ ok: true });
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
        "username, name, email, status (\"accepted\" or \"pending\") and role: editor (changes " +
        "anything a member can), commenter (sees the list and comments) or viewer (sees it only). " +
        "Use a row's user_id with remove_member or set_member_role; only editors can be in update_item's assignee_ids.",
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
    "list_collaborators",
    {
      title: "List collaborators",
      description:
        "The people the user shares a list or a Space with (owners and accepted members; pending invites don't count), " +
        "each with userId, username, displayUsername, name and email. Use it to work out who the user means by a name " +
        "(\"share it with Sam\"): if more than one person matches, ask which. Someone not listed can still be invited by username or email. " +
        "Pass list_id or space_id (at most one) when the user wants someone in a place, such as sharing an item, which means its list. " +
        "Then it returns { canInvite, people }: people also includes anyone already in that place, invites included, and each has access, " +
        "every way they can open it: { via: list or space, role, pending }. A list's owner has role owner; via space means they get in through the list's Space. " +
        "access [] means they can't open it yet: invite them (invite_member, invite_space_member or invite_people) if canInvite, " +
        "else tell the user who can (the list's owner, or a Space admin). If they're already in, say so instead of inviting them again; " +
        "pending means invited but not accepted yet; a viewer or commenter who needs more can have their role raised (set_member_role or set_space_member_role).",
      inputSchema: {
        list_id: z.string().min(1).optional(),
        space_id: z.string().min(1).optional(),
      },
    },
    async ({ list_id, space_id }) => {
      const { db } = getDb();
      if (list_id && space_id) return errorText("Pass list_id or space_id, not both.");
      if (!list_id && !space_id) return json(listCollaborators(db, userId));
      const found = collaboratorAccess(
        db,
        userId,
        list_id ? { kind: "list", id: list_id } : { kind: "space", id: space_id ?? "" },
      );
      if (!found) return list_id ? notFound("list", list_id) : notFound("space", space_id ?? "");
      return json(found);
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
        "Lands a pending invite they must accept before they gain access. " +
        "role is what they can do once they join: editor (the default) changes everything except owner-only actions " +
        "(delete, prefix, managing members); commenter sees the list and comments on its items; viewer only sees it. " +
        "Use the role the user asked for; when they said to share it read-only or just so someone can see it, that's viewer. " +
        "only_mine (viewer or commenter) shows them only the items assigned to the user, as for an accountability partner.",
      inputSchema: {
        list_id: z.string(),
        person: z.string().min(1),
        role: z.enum(LIST_ROLES).optional(),
        only_mine: z
          .boolean()
          .optional()
          .describe("Viewers and commenters only: they see just the items assigned to you (the user), not the rest of the list."),
        only_within: z.enum(ONLY_WITHIN).nullable().optional().describe("With only_mine: today or week shows them only those of your items in your today (due today, overdue, or finished today) or your week (Monday to Sunday), by your clock; null shows every day. Leave it out to keep it as it is."),
      },
    },
    async ({ list_id, person, role, only_mine, only_within }) => {
      const { db } = getDb();
      const project = getProject(db, userId, list_id);
      if (!project) return notFound("list", list_id);
      const member = inviteMember(db, userId, list_id, person, SOURCE, role, { onlyMine: only_mine, within: only_within });
      await sendInviteNotification(db, ctx.baseUrl, userId, project.name, member.email, "list", role, only_mine, only_within);
      return json(member);
    },
  );

  server.registerTool(
    "set_member_role",
    {
      title: "Set a list member's role",
      description:
        "Change what a member, or someone invited, can do on a list (owner only): editor, commenter (sees the list and comments) " +
        "or viewer (sees it only). user_id comes from list_members. Taking edit away takes them off the list's items " +
        "and ends their agents' work there, unless the list's Space still lets them edit. " +
        "only_mine turns showing them only the user's items on or off; leave it out to keep it as it is. Editors always see everything.",
      inputSchema: {
        list_id: z.string(),
        user_id: z.string(),
        role: z.enum(LIST_ROLES),
        only_mine: z
          .boolean()
          .optional()
          .describe("Viewers and commenters only: they see just the items assigned to you (the user), not the rest of the list."),
        only_within: z.enum(ONLY_WITHIN).nullable().optional().describe("With only_mine: today or week shows them only those of your items in your today (due today, overdue, or finished today) or your week (Monday to Sunday), by your clock; null shows every day. Leave it out to keep it as it is."),
      },
    },
    async ({ list_id, user_id, role, only_mine, only_within }) => {
      const { db } = getDb();
      if (!getProject(db, userId, list_id)) return notFound("list", list_id);
      setMemberRole(db, userId, list_id, user_id, role, SOURCE, only_mine, only_within);
      return json({ ok: true });
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
        "Each has id, name, icon, color (null is grey) and the user's role: admin (manages its people and the Space itself), member (edits its lists), commenter (sees its lists and comments) or viewer (sees its lists only). " +
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
        "status (\"accepted\" or \"pending\") and role (\"admin\", \"member\", \"commenter\" or \"viewer\"). " +
        "Use a row's user_id with remove_space_member or set_space_member_role, or, for an admin or member, with update_item's assignee_ids.",
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
    "invite_people",
    {
      title: "Invite people to several places",
      description:
        "Invite one or more existing users to several lists and Spaces at once, each place with its own role, " +
        "as one invite: all of it lands or none does. people are usernames (\"alice\" or \"@alice\") or emails. " +
        "Each place is a list_id (owner only; role editor, commenter or viewer) or a space_id (admins only; " +
        "role member, commenter or viewer). Each invitee gets one push and one email naming every place; " +
        "people already in a place hear only of that place. Use it instead of invite_member / invite_space_member " +
        "when the user names more than one place or person. A place's only_mine (viewer or commenter) shows them only the user's items there, and its only_within (today or week) only those in the user's today or week. " +
        "Check with the user before inviting someone they didn't name.",
      inputSchema: {
        people: z.array(z.string().min(1)).min(1),
        places: z
          .array(
            z.union([
              z.object({
                list_id: z.string(),
                role: z.enum(LIST_ROLES).optional(),
                only_mine: z.boolean().optional(),
                only_within: z.enum(ONLY_WITHIN).nullable().optional(),
              }),
              z.object({
                space_id: z.string(),
                role: z.enum(["member", "commenter", "viewer"]).optional(),
                only_mine: z.boolean().optional(),
                only_within: z.enum(ONLY_WITHIN).nullable().optional(),
              }),
            ]),
          )
          .min(1),
      },
    },
    async ({ people, places }) => {
      const { db } = getDb();
      const spaces = listSpaces(db, userId);
      const resolved: InvitePlace[] = [];
      for (const p of places) {
        if ("list_id" in p) {
          if (!getProject(db, userId, p.list_id)) return notFound("list", p.list_id);
          resolved.push({ kind: "list", id: p.list_id, role: p.role ?? "editor", onlyMine: p.only_mine, within: p.only_within });
        } else {
          if (!spaces.some((s) => s.id === p.space_id)) return notFound("space", p.space_id);
          resolved.push({ kind: "space", id: p.space_id, role: p.role ?? "member", onlyMine: p.only_mine, within: p.only_within });
        }
      }
      const { sent, places: invited } = invitePeople(db, userId, { people, places: resolved }, SOURCE);
      const named = invited.map(({ name, kind, role, onlyMine, within }) => ({ name, kind, role, onlyMine, within }));
      const inviterName = getUserName(db, userId) ?? "Someone";
      const emails = new Set(sent.flatMap((s) => (s.member.email ? [s.member.email] : [])));
      for (const to of emails) {
        await notifyInvite({
          to,
          inviterName,
          projectName: named[0].name,
          url: ctx.baseUrl,
          kind: named[0].kind,
          role: named[0].role,
          onlyMine: named[0].onlyMine,
          within: named[0].within,
          places: named,
        });
      }
      return json(sent.map((s) => ({ [s.kind === "list" ? "list_id" : "space_id"]: s.placeId, ...s.member })));
    },
  );

  server.registerTool(
    "invite_space_member",
    {
      title: "Invite to a Space",
      description:
        "Invite an existing user to a Space (admins only). person is a username (\"alice\" or \"@alice\") or an email; " +
        "they must already have an account. Once they accept they see every list in the Space, and role says what else: " +
        "member (the default) edits them, commenter comments on their items, viewer only sees them. " +
        "only_mine (viewer or commenter) shows them only the items assigned to the user. " +
        "Check with the user before inviting someone they didn't name.",
      inputSchema: {
        space_id: z.string(),
        person: z.string().min(1),
        role: z.enum(["member", "commenter", "viewer"]).optional(),
        only_mine: z
          .boolean()
          .optional()
          .describe("Viewers and commenters only: they see just the items assigned to you (the user), not the rest of the list."),
        only_within: z.enum(ONLY_WITHIN).nullable().optional().describe("With only_mine: today or week shows them only those of your items in your today (due today, overdue, or finished today) or your week (Monday to Sunday), by your clock; null shows every day. Leave it out to keep it as it is."),
      },
    },
    async ({ space_id, person, role, only_mine, only_within }) => {
      const { db } = getDb();
      const space = listSpaces(db, userId).find((s) => s.id === space_id);
      if (!space) return notFound("space", space_id);
      const member = inviteSpaceMember(db, userId, space_id, person, SOURCE, role, { onlyMine: only_mine, within: only_within });
      await sendInviteNotification(db, ctx.baseUrl, userId, space.name, member.email, "space", role, only_mine, only_within);
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
        "Change someone's role in a Space (admins only): admin (manages the Space and its people, and edits its lists), member (edits its lists), " +
        "commenter (sees its lists and comments) or viewer (sees its lists only). user_id comes from list_space_members, " +
        "and they must have accepted. All admins are equal. A Space always keeps an admin, so the last admin can't be given another role. " +
        "Taking edit away takes them off the items they're assigned in the Space. " +
        "only_mine turns showing them only the user's items on or off; leave it out to keep it as it is. Admins and members always see everything.",
      inputSchema: {
        space_id: z.string(),
        user_id: z.string(),
        role: z.enum(SPACE_ROLES),
        only_mine: z
          .boolean()
          .optional()
          .describe("Viewers and commenters only: they see just the items assigned to you (the user), not the rest of the list."),
        only_within: z.enum(ONLY_WITHIN).nullable().optional().describe("With only_mine: today or week shows them only those of your items in your today (due today, overdue, or finished today) or your week (Monday to Sunday), by your clock; null shows every day. Leave it out to keep it as it is."),
      },
    },
    async ({ space_id, user_id, role, only_mine, only_within }) => {
      const { db } = getDb();
      if (!isJoined(db, space_id)) return notFound("space", space_id);
      setSpaceMemberRole(db, userId, space_id, user_id, role, SOURCE, only_mine, only_within);
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
