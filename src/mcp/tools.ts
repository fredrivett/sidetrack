import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { type AuditOrigin, listAudit } from "@/core/audit";
import { addCategory, listCategories } from "@/core/categories";
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
  reorderItem,
  setItemParent,
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
  type Item,
  PROJECT_STATUSES,
} from "@/core/schema";
import { notifyInvite } from "@/lib/email";
import { getEnv } from "@/lib/env";
import { formatItemRef } from "@/lib/itemRef";
import { MAX_REPEAT_EVERY, REPEAT_UNITS } from "@/lib/repeat";
import { formatRelativeLong, isDay } from "@/lib/time";
import { matchesWhose, WHOSE_FILTERS } from "@/lib/whose";

/** The authenticated caller: the key's owner and the key itself (the agent). */
export interface McpContext {
  userId: string;
  agent: { keyId: string; name: string };
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

function forAgent(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(forAgent);
  if (value && Object.getPrototypeOf(value) === Object.prototype) {
    let obj = value as Record<string, unknown>;
    // An item's repeat rule goes out as one `repeat` field, the shape
    // add_item and update_item take: { every, unit }, or null.
    if ("repeatUnit" in obj && "repeatEvery" in obj) {
      const { repeatEvery, repeatUnit, ...rest } = obj;
      obj = { ...rest, repeat: repeatUnit ? { every: repeatEvery, unit: repeatUnit } : null };
    }
    return Object.fromEntries(
      Object.entries(obj).map(([k, v]) => [AGENT_KEYS[k] ?? k, forAgent(v)]),
    );
  }
  return value;
}

function json(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(forAgent(value), null, 2),
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
// link is the app root (BETTER_AUTH_URL); with no transport set, the email
// layer logs it server-side.
async function sendInviteNotification(
  db: Db,
  inviterId: string,
  projectName: string,
  toEmail: string | null,
) {
  if (!toEmail) return;
  await notifyInvite({
    to: toEmail,
    inviterName: getUserName(db, inviterId) ?? "Someone",
    projectName,
    url: getEnv().BETTER_AUTH_URL?.replace(/\/$/, "") ?? "",
  });
}

export function registerTools(server: McpServer, ctx: McpContext) {
  const { userId } = ctx;
  // Every mutation is logged as "mcp" plus the API key the agent used, so the
  // activity log can say which agent made each change.
  const SOURCE: AuditOrigin = { source: "mcp", agent: ctx.agent };

  server.registerTool(
    "list_lists",
    {
      title: "List lists",
      description:
        "List the user's lists in board order (left to right, per their own board). Returns id, name, status, summary, summaryUpdatedAt and more. " +
        "status is active (on the board), paused (collapsed at the end of the board; set aside for now) or archived (off the board, kept for reference). " +
        "Archived lists are left out unless include_archived is true.",
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
        "Fetch a list with its items in position order. Pass include_completed: true to also return completed items. Works for archived lists too.",
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
        "- Each list is a top-level node; its items nest beneath it. Mark a paused list as paused.\n" +
        "- Keep lists and items in the order returned; do not re-sort unless the user asked for a different order.\n" +
        "- Do not show completed items in the tree.\n" +
        "- A task is a box-drawing branch, e.g. `├── Write the docs`.\n" +
        "- An item's sub-items (its checklist, in `children`) nest one level beneath it, e.g. `│   ├── Kitchen`.",
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
        "The user's Today view: items across their active lists (not paused or archived) that are due today or overdue, " +
        "plus items finished today, which the user sees crossed out. Overdue items come first, then by board order. " +
        "Returns { today, timeZone, items }, plus a note when the timezone is a UTC fallback. today is the user's current day (YYYY-MM-DD) in timeZone, which their browser reports; " +
        "the day turns over at 4am, so at 1am it's still the day before. Use today to work out dates like tomorrow for due_date. " +
        "Each item carries its ref, listName and, for a sub-item, parentTitle. " +
        "filter narrows to items assigned to the user (mine), to someone else (theirs), or to nobody (unassigned).\n" +
        "Show the user the items as a list with the list name, anything overdue marked, and finished ones crossed out, as on their screen.",
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
        "The user's No date view: tasks with no due date across their active lists (not paused or archived), " +
        "for planning when to do them. Sub-items of a dated parent are left out, since they are planned with their parent. " +
        "Items finished today are included, which the user sees crossed out. " +
        "Returns { today, timeZone, lists }, plus a note when the timezone is a UTC fallback; today works as in list_today. " +
        "lists is in board order, each { list, items } with items in list order and an undated parent's undated sub-items nested in children; " +
        "lists with nothing undated are left out. A sub-item whose parent isn't shown carries parentTitle. " +
        "filter narrows to items assigned to the user (mine), to someone else (theirs), or to nobody (unassigned).\n" +
        "Show the user the items grouped under each list name, sub-items indented, finished ones crossed out, as on their screen. " +
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
        "status defaults to active.",
      inputSchema: {
        name: z.string().min(1),
        status: Status.optional(),
      },
    },
    async ({ name, status }) => {
      const { db } = getDb();
      return json(createProject(db, userId, { name, status }, SOURCE));
    },
  );

  server.registerTool(
    "update_list",
    {
      title: "Update list",
      description:
        "Patch name/status/summary/prefix/homepage_url/icon. Setting summary stamps summaryUpdatedAt. " +
        "status is active, paused (collapse it at the end of the board) or archived (take it off the board; its items are kept, and setting active restores it). " +
        "Archive a finished list rather than deleting it unless the user asks to delete. " +
        "prefix is the short item-ID prefix (2–5 letters, e.g. \"ENG\" → items like ENG-42); " +
        "it is uppercased, and an auto-suffix is applied if it collides with another list. " +
        "homepage_url is the list's public landing URL — a bare host gains an https:// scheme; pass null to clear it. " +
        "icon is the list icon: an emoji (e.g. \"🚀\") or an http(s) image URL; pass null to clear it (falls back to the homepage favicon).",
      inputSchema: {
        id: z.string(),
        name: z.string().optional(),
        status: Status.optional(),
        summary: z.string().optional(),
        prefix: z.string().optional(),
        homepage_url: z.string().nullable().optional(),
        icon: z.string().nullable().optional(),
      },
    },
    async ({ id, homepage_url, ...patch }) => {
      const { db } = getDb();
      if (!getProject(db, userId, id)) return notFound("list", id);
      return json(
        updateProject(
          db,
          userId,
          id,
          homepage_url === undefined
            ? patch
            : { ...patch, homepageUrl: homepage_url },
          SOURCE,
        ),
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
        "Fetch a single item by reference — its title, description, category, and completion state, " +
        "plus its sub-items (its checklist) as `children`, finished ones included. A sub-item has a parentId. " +
        "Use this to answer a question about one item without pulling its whole list. " +
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
      return json({ ...withRef, children: withRefs(prefix, children) });
    },
  );

  server.registerTool(
    "add_item",
    {
      title: "Add item",
      description:
        "Add a task to a list. description is optional free-text. " +
        "category is free-text and is auto-created if new. " +
        "parent (a short ref or id) adds the task as a sub-item of that task, one step in its checklist: " +
        "e.g. \"Tidy up flat\" with sub-items Lounge, Kitchen and Bedroom. Sub-items are one level deep; " +
        "each is a full item with its own ref and assignee. Adding an open one to a finished parent reopens the parent; adding one with completed: true leaves it finished. " +
        "due_date is the calendar day it's due, YYYY-MM-DD (no time); call list_today first if you need today's date in the user's timezone. " +
        "assignee_id assigns it to the list owner or an accepted member (get a user_id from list_members). " +
        "completed: true creates it already done, in one call — use it when the user tells you about something they've finished, " +
        "instead of add_item then complete_item. " +
        "repeat makes a task come round again: { every, unit } with unit day, week or month, e.g. { every: 3, unit: \"day\" } for every 3 days. " +
        "The next due date counts from the day it was last completed, not a fixed calendar: completing it leaves it crossed out for the rest of the day, " +
        "then on the day `every` units after the day it was done it reopens as the same item (same ref), due that day. " +
        "A month later keeps the day of the month, or the month's last day when that's shorter. " +
        "position defaults to end (the bottom of the list, or of the parent's sub-items); top|end|after:<item>|before:<item> are also valid, " +
        "where <item> is a short ref (e.g. \"HOM-12\") or an id of a sibling (same list, same parent). " +
        "Returns { created, items } where items is every incomplete item in the list in position order " +
        "(so an item created completed is in created but not items).\n" +
        "After adding, show the user the list's updated items (the items array) so they can see where " +
        "the new item landed, unless the user asked you not to:\n" +
        "- Keep items in the order returned; do not re-sort unless the user asked for a different order.\n" +
        "- A task is a box-drawing branch, e.g. `├── Write the docs`.\n" +
        "- Sub-items (in `children`) nest one level beneath their parent, e.g. `│   ├── Kitchen`.",
      inputSchema: {
        list_id: z.string(),
        title: z.string().min(1),
        description: z.string().optional(),
        category: z.string().optional(),
        parent: z.string().optional(),
        due_date: DueDate.nullable().optional(),
        assignee_id: z.string().optional(),
        completed: z.boolean().optional(),
        repeat: Repeat.nullable().optional(),
        position: PosRef.optional(),
      },
    },
    async ({
      list_id,
      title,
      description,
      category,
      parent,
      due_date,
      assignee_id,
      completed,
      repeat,
      position,
    }) => {
      const { db } = getDb();
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
      const created = addItem(
        db,
        userId,
        {
          projectId: list_id,
          title,
          description,
          category,
          parentId,
          dueDate: due_date,
          assigneeId: assignee_id,
          completed,
          repeat,
          positionRef: pos.position,
        },
        SOURCE,
      );
      const refPrefix = projectRefPrefixes(db, userId)[list_id] ?? project.prefix;
      return json({
        created: { ...created, ref: formatItemRef(refPrefix, created.number) },
        items: withRefs(refPrefix, listItems(db, userId, list_id)),
      });
    },
  );

  server.registerTool(
    "update_item",
    {
      title: "Update item",
      description:
        "Patch title/description/category/assignee/due_date/repeat on an item. Pass description or category as null to clear it. " +
        "assignee_id assigns the item to a user — the list owner or an accepted member (get a user_id from list_members); " +
        "pass null to unassign. due_date sets the calendar day it's due (YYYY-MM-DD, no time); pass null to clear it. " +
        "repeat sets how often a task comes round again, { every, unit } (see add_item); pass null to stop it repeating. " +
        "id accepts the item's short ref (e.g. \"ENG-42\") or its internal id.",
      inputSchema: {
        id: z.string(),
        title: z.string().optional(),
        description: z.string().nullable().optional(),
        category: z.string().nullable().optional(),
        assignee_id: z.string().nullable().optional(),
        due_date: DueDate.nullable().optional(),
        repeat: Repeat.nullable().optional(),
      },
    },
    async ({ id, assignee_id, due_date, ...patch }) => {
      const { db } = getDb();
      const { item, error } = resolveItemArg(db, userId, id);
      if (error) return error;
      return json(
        withItemRef(
          db,
          userId,
          updateItem(
            db,
            userId,
            item.id,
            { ...patch, assigneeId: assignee_id, dueDate: due_date },
            SOURCE,
          ),
        ),
      );
    },
  );

  server.registerTool(
    "complete_item",
    {
      title: "Complete item",
      description:
        "Mark an item as completed. It keeps its place in the list: the user sees it crossed out for the rest of the day " +
        "(the day turns over at 4am their time), then it moves to the list's Done section. " +
        "Completing an item with sub-items also completes its open sub-items; completing the last sub-item does not complete the parent. " +
        "A repeating item (one with a repeat rule) reopens by itself on its next due date: `every` units after the day it was completed. " +
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
    "list_categories",
    {
      title: "List categories",
      description: "List all known categories for a list.",
      inputSchema: { list_id: z.string() },
    },
    async ({ list_id }) => {
      const { db } = getDb();
      return json(listCategories(db, userId, list_id));
    },
  );

  server.registerTool(
    "add_category",
    {
      title: "Add category",
      description:
        "Idempotently add a category to a list. Items can also be created with a new category — they will auto-insert.",
      inputSchema: { list_id: z.string(), name: z.string().min(1) },
    },
    async ({ list_id, name }) => {
      const { db } = getDb();
      if (!getProject(db, userId, list_id)) return notFound("list", list_id);
      return json(addCategory(db, userId, list_id, name, SOURCE));
    },
  );

  server.registerTool(
    "list_audit",
    {
      title: "List audit log",
      description:
        "Recent change history (newest first). Every create/update/complete/uncomplete/reorder/delete is logged with its source (web or mcp; system for a change nobody made, such as a repeating item reopening on its next due date), agentName (the API key name of the agent that made an mcp change) and a human summary. Each row includes `when`, a ready-to-display relative time (e.g. \"just now\", \"5 minutes ago\", \"7 months ago\") — show that to the user, not the raw `ts` epoch. Optionally filter by list_id or source.",
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
        "row's user_id with remove_member.",
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
      await sendInviteNotification(db, userId, project.name, member.email);
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
        "List invites awaiting your response: each has listId, listName, " +
        "ownerName and createdAt. Accept with accept_invite or dismiss with " +
        "decline_invite, passing the invite's listId as list_id.",
      inputSchema: {},
    },
    async () => {
      const { db } = getDb();
      return json(listPendingInvites(db, userId));
    },
  );

  server.registerTool(
    "accept_invite",
    {
      title: "Accept an invite",
      description:
        "Accept a pending invite to a list, gaining edit access. " +
        "list_id comes from list_pending_invites.",
      inputSchema: { list_id: z.string() },
    },
    async ({ list_id }) => {
      const { db } = getDb();
      acceptInvite(db, userId, list_id, SOURCE);
      return json({ ok: true });
    },
  );

  server.registerTool(
    "decline_invite",
    {
      title: "Decline an invite",
      description:
        "Decline a pending invite, removing it. list_id comes from " +
        "list_pending_invites.",
      inputSchema: { list_id: z.string() },
    },
    async ({ list_id }) => {
      const { db } = getDb();
      declineInvite(db, userId, list_id, SOURCE);
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
}
