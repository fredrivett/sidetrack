import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { listAudit } from "@/core/audit";
import { addCategory, listCategories } from "@/core/categories";
import { getDb } from "@/core/db";
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
  reorderItem,
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
  listProjects,
  reorderProject,
  updateProject,
} from "@/core/projects";
import {
  AUDIT_SOURCES,
  ITEM_KINDS,
  type Item,
  PROJECT_STATUSES,
} from "@/core/schema";
import { notifyInvite } from "@/lib/email";
import { getEnv } from "@/lib/env";
import { formatItemRef } from "@/lib/itemRef";
import { formatRelativeLong } from "@/lib/time";

const SOURCE = "mcp" as const;

const Status = z.enum(PROJECT_STATUSES);
const Kind = z.enum(ITEM_KINDS);
const PosRef = z
  .string()
  .regex(/^(top|end|after:.+|before:.+)$/, "expected top|end|after:<id>|before:<id>");
const ProjectPosRef = z
  .string()
  .regex(/^(start|end|after:.+|before:.+)$/, "expected start|end|after:<id>|before:<id>");

function json(value: unknown) {
  return {
    content: [
      { type: "text" as const, text: JSON.stringify(value, null, 2) },
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
              `Ambiguous item ref "${raw}": its prefix matches multiple projects ` +
              `you can access. Qualify it with the owner (${options}) or use the ` +
              `item's id — no change was made.`,
          },
        ],
      },
    };
  }
  return { item: null, error: notFound("item", raw) };
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

function withRefs(prefix: string, list: Item[]) {
  return list.map((i) => ({ ...i, ref: formatItemRef(prefix, i.number) }));
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

export function registerTools(
  server: McpServer,
  ctx: { userId: string },
) {
  const { userId } = ctx;

  server.registerTool(
    "list_projects",
    {
      title: "List projects",
      description:
        "List every project in kanban order (left to right, per your own board). Returns id, name, status, summary, summary_updated_at.",
      inputSchema: {},
    },
    async () => {
      const { db } = getDb();
      return json(listProjects(db, userId));
    },
  );

  server.registerTool(
    "get_project",
    {
      title: "Get project",
      description:
        "Fetch a project with its items in position order. Pass include_completed: true to also return completed items.",
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
      if (!result) return notFound("project", id);
      const refPrefix =
        projectRefPrefixes(db, userId)[result.project.id] ?? result.project.prefix;
      return json({
        project: result.project,
        items: withRefs(refPrefix, result.items),
      });
    },
  );

  server.registerTool(
    "list_all_items",
    {
      title: "List all items across projects",
      description:
        "Fetch every project together with its items — the whole board in one call. " +
        "Projects come back in kanban order; each carries its own items array in position order. " +
        "include_completed defaults to false; pass true only when the user explicitly wants completed items.\n" +
        "Render the result for the user as an indented tree:\n" +
        "- Each project is a top-level node; its items nest beneath it.\n" +
        "- Keep projects and items in the order returned; do not re-sort unless the user asked for a different order.\n" +
        "- Do not show completed items in the tree.\n" +
        "- A task is a box-drawing branch, e.g. `├── Write the docs`.\n" +
        "- A milestone is a divider, not a task row: a single dashed line with its title centred in it, " +
        "e.g. `─ ─ ─  v1.0 launch  ─ ─ ─`. It marks a point in the list rather than something to check off.",
      inputSchema: {
        include_completed: z.boolean().optional(),
      },
    },
    async ({ include_completed }) => {
      const { db } = getDb();
      const refs = projectRefPrefixes(db, userId);
      return json(
        listAllProjectsWithItems(db, userId, {
          includeCompleted: include_completed,
        }).map(({ project, items }) => ({
          project,
          items: withRefs(refs[project.id] ?? project.prefix, items),
        })),
      );
    },
  );

  server.registerTool(
    "create_project",
    {
      title: "Create project",
      description: "Create a new project. Appends at the right of the kanban.",
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
    "update_project",
    {
      title: "Update project",
      description:
        "Patch name/status/summary/prefix/homepage_url. Setting summary stamps summary_updated_at. " +
        "prefix is the short item-ID prefix (2–5 letters, e.g. \"ENG\" → items like ENG-42); " +
        "it is uppercased, and an auto-suffix is applied if it collides with another project. " +
        "homepage_url is the project's public landing URL — a bare host gains an https:// scheme; pass null to clear it. " +
        "icon is the project icon: an emoji (e.g. \"🚀\") or an http(s) image URL; pass null to clear it (falls back to the homepage favicon).",
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
      if (!getProject(db, userId, id)) return notFound("project", id);
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
    "reorder_project",
    {
      title: "Reorder project",
      description:
        "Move a project. position is one of: start | end | after:<id> | before:<id>.",
      inputSchema: {
        id: z.string(),
        position: ProjectPosRef,
      },
    },
    async ({ id, position }) => {
      const { db } = getDb();
      if (!getProject(db, userId, id)) return notFound("project", id);
      return json(reorderProject(db, userId, id, position, SOURCE));
    },
  );

  server.registerTool(
    "delete_project",
    {
      title: "Delete project",
      description: "Delete a project and all its items.",
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
        "Fetch a single item by reference — its title, description, category, kind, and completion state. " +
        "Use this to answer a question about one item without pulling its whole project. " +
        "id accepts the item's short ref (e.g. \"ENG-42\") or its internal id; the result carries its display `ref`.",
      inputSchema: { id: z.string() },
    },
    async ({ id }) => {
      const { db } = getDb();
      const { item, error } = resolveItemArg(db, userId, id);
      if (error) return error;
      return json(withItemRef(db, userId, item));
    },
  );

  server.registerTool(
    "add_item",
    {
      title: "Add item",
      description:
        "Add a task or milestone to a project. description is optional free-text. " +
        "category is free-text and is auto-created if new. " +
        "position defaults to end of the active range; top|end|after:<id>|before:<id> are also valid. " +
        "Returns { created, items } where items is every incomplete item in the project in position order.\n" +
        "After adding, show the user the project's updated list (the items array) so they can see where " +
        "the new item landed, unless the user asked you not to:\n" +
        "- Keep items in the order returned; do not re-sort unless the user asked for a different order.\n" +
        "- A task is a box-drawing branch, e.g. `├── Write the docs`.\n" +
        "- A milestone is a divider, not a task row: a single dashed line with its title centred in it, " +
        "e.g. `─ ─ ─  v1.0 launch  ─ ─ ─`.",
      inputSchema: {
        project_id: z.string(),
        kind: Kind,
        title: z.string().min(1),
        description: z.string().optional(),
        category: z.string().optional(),
        position: PosRef.optional(),
      },
    },
    async ({ project_id, kind, title, description, category, position }) => {
      const { db } = getDb();
      const project = getProject(db, userId, project_id);
      if (!project) return notFound("project", project_id);
      const created = addItem(
        db,
        userId,
        {
          projectId: project_id,
          kind,
          title,
          description,
          category,
          positionRef: position,
        },
        SOURCE,
      );
      const refPrefix = projectRefPrefixes(db, userId)[project_id] ?? project.prefix;
      return json({
        created: { ...created, ref: formatItemRef(refPrefix, created.number) },
        items: withRefs(refPrefix, listItems(db, userId, project_id)),
      });
    },
  );

  server.registerTool(
    "update_item",
    {
      title: "Update item",
      description:
        "Patch title/description/category/assignee on an item. Pass description or category as null to clear it. " +
        "assignee_id assigns the item to a user — the project owner or an accepted member (get a user_id from list_members); " +
        "pass null to unassign. id accepts the item's short ref (e.g. \"ENG-42\") or its internal id.",
      inputSchema: {
        id: z.string(),
        title: z.string().optional(),
        description: z.string().nullable().optional(),
        category: z.string().nullable().optional(),
        assignee_id: z.string().nullable().optional(),
      },
    },
    async ({ id, assignee_id, ...patch }) => {
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
            { ...patch, assigneeId: assignee_id },
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
        "Mark an item as completed. It moves to the upper completed range, sitting closest to the active boundary. " +
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
        "Restore a completed item. It lands at the top of the active range. " +
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
        "Move an item within its project. position is top | end | after:<id> | before:<id>. " +
        "id accepts the item's short ref (e.g. \"ENG-42\") or its internal id.",
      inputSchema: { id: z.string(), position: PosRef },
    },
    async ({ id, position }) => {
      const { db } = getDb();
      const { item, error } = resolveItemArg(db, userId, id);
      if (error) return error;
      return json(
        withItemRef(db, userId, reorderItem(db, userId, item.id, position, SOURCE)),
      );
    },
  );

  server.registerTool(
    "delete_item",
    {
      title: "Delete item",
      description:
        "Delete an item. id accepts the item's short ref (e.g. \"ENG-42\") or its internal id.",
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
      description: "List all known categories for a project.",
      inputSchema: { project_id: z.string() },
    },
    async ({ project_id }) => {
      const { db } = getDb();
      return json(listCategories(db, userId, project_id));
    },
  );

  server.registerTool(
    "add_category",
    {
      title: "Add category",
      description:
        "Idempotently add a category to a project. Items can also be created with a new category — they will auto-insert.",
      inputSchema: { project_id: z.string(), name: z.string().min(1) },
    },
    async ({ project_id, name }) => {
      const { db } = getDb();
      if (!getProject(db, userId, project_id)) return notFound("project", project_id);
      return json(addCategory(db, userId, project_id, name, SOURCE));
    },
  );

  server.registerTool(
    "list_audit",
    {
      title: "List audit log",
      description:
        "Recent change history (newest first). Every create/update/complete/uncomplete/reorder/delete is logged with its source (web or mcp) and a human summary. Each row includes `when`, a ready-to-display relative time (e.g. \"just now\", \"5 minutes ago\", \"7 months ago\") — show that to the user, not the raw `ts` epoch. Optionally filter by project_id or source.",
      inputSchema: {
        project_id: z.string().optional(),
        source: z.enum(AUDIT_SOURCES).optional(),
        limit: z.number().int().min(1).max(500).optional(),
      },
    },
    async ({ project_id, source, limit }) => {
      const { db } = getDb();
      const rows = listAudit(db, userId, {
        projectId: project_id,
        source,
        limit,
      });
      return json(
        rows.map(({ ts, ...rest }) => ({
          ts,
          when: formatRelativeLong(ts),
          ...rest,
        })),
      );
    },
  );

  server.registerTool(
    "list_members",
    {
      title: "List project members",
      description:
        "List a project's collaborators and pending invites (the owner is not " +
        "included — it's the project's owner separately). Each row has user_id, " +
        "username, name, email, and status (\"accepted\" or \"pending\"). Use a " +
        "row's user_id with remove_member.",
      inputSchema: { project_id: z.string() },
    },
    async ({ project_id }) => {
      const { db } = getDb();
      if (!getProject(db, userId, project_id)) {
        return notFound("project", project_id);
      }
      return json(listMembers(db, userId, project_id));
    },
  );

  server.registerTool(
    "invite_member",
    {
      title: "Invite a member",
      description:
        "Invite an existing user to collaborate on a project (owner only). " +
        "person is a username (\"alice\" or \"@alice\") or an email. The target " +
        "must already have an account — there is no invite-by-email-to-sign-up. " +
        "Lands a pending invite they must accept before they gain access; " +
        "accepted members can edit everything except owner-only actions " +
        "(delete, prefix, managing members).",
      inputSchema: { project_id: z.string(), person: z.string().min(1) },
    },
    async ({ project_id, person }) => {
      const { db } = getDb();
      const project = getProject(db, userId, project_id);
      if (!project) return notFound("project", project_id);
      const member = inviteMember(db, userId, project_id, person, SOURCE);
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
        "user_id is the value from list_members. To leave a project yourself, " +
        "use leave_project instead.",
      inputSchema: { project_id: z.string(), user_id: z.string() },
    },
    async ({ project_id, user_id }) => {
      const { db } = getDb();
      removeMember(db, userId, project_id, user_id, SOURCE);
      return json({ ok: true });
    },
  );

  server.registerTool(
    "list_pending_invites",
    {
      title: "List my pending invites",
      description:
        "List invites awaiting your response: each has project_id, " +
        "project_name, and owner_name. Accept with accept_invite or dismiss " +
        "with decline_invite.",
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
        "Accept a pending invite to a project, gaining edit access. " +
        "project_id comes from list_pending_invites.",
      inputSchema: { project_id: z.string() },
    },
    async ({ project_id }) => {
      const { db } = getDb();
      acceptInvite(db, userId, project_id, SOURCE);
      return json({ ok: true });
    },
  );

  server.registerTool(
    "decline_invite",
    {
      title: "Decline an invite",
      description:
        "Decline a pending invite, removing it. project_id comes from " +
        "list_pending_invites.",
      inputSchema: { project_id: z.string() },
    },
    async ({ project_id }) => {
      const { db } = getDb();
      declineInvite(db, userId, project_id, SOURCE);
      return json({ ok: true });
    },
  );

  server.registerTool(
    "leave_project",
    {
      title: "Leave a project",
      description:
        "Remove yourself from a project you were invited to (you keep nothing). " +
        "The owner can't leave their own project — delete it instead.",
      inputSchema: { project_id: z.string() },
    },
    async ({ project_id }) => {
      const { db } = getDb();
      removeMember(db, userId, project_id, userId, SOURCE);
      return json({ ok: true });
    },
  );
}
