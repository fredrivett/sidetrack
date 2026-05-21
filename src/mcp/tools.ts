import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { listAudit } from "@/core/audit";
import { addCategory, listCategories } from "@/core/categories";
import { getDb } from "@/core/db";
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
  createProject,
  deleteProject,
  getProject,
  getProjectWithItems,
  listAllProjectsWithItems,
  listProjects,
  reorderProject,
  updateProject,
} from "@/core/projects";
import { AUDIT_SOURCES, ITEM_KINDS, PROJECT_STATUSES } from "@/core/schema";
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

export function registerTools(server: McpServer) {
  server.registerTool(
    "list_projects",
    {
      title: "List projects",
      description:
        "List every project in kanban order (left to right). Returns id, name, status, summary, summary_updated_at, position.",
      inputSchema: {},
    },
    async () => {
      const { db } = getDb();
      return json(listProjects(db));
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
      const result = getProjectWithItems(db, id, {
        includeCompleted: include_completed,
      });
      if (!result) return notFound("project", id);
      return json(result);
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
      return json(
        listAllProjectsWithItems(db, { includeCompleted: include_completed }),
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
      return json(createProject(db, { name, status }, SOURCE));
    },
  );

  server.registerTool(
    "update_project",
    {
      title: "Update project",
      description:
        "Patch name/status/summary. Setting summary stamps summary_updated_at.",
      inputSchema: {
        id: z.string(),
        name: z.string().optional(),
        status: Status.optional(),
        summary: z.string().optional(),
      },
    },
    async ({ id, ...patch }) => {
      const { db } = getDb();
      if (!getProject(db, id)) return notFound("project", id);
      return json(updateProject(db, id, patch, SOURCE));
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
      if (!getProject(db, id)) return notFound("project", id);
      return json(reorderProject(db, id, position, SOURCE));
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
      deleteProject(db, id, SOURCE);
      return json({ ok: true });
    },
  );

  server.registerTool(
    "add_item",
    {
      title: "Add item",
      description:
        "Add a task or milestone to a project. Category is free-text and is auto-created if new. " +
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
        category: z.string().optional(),
        position: PosRef.optional(),
      },
    },
    async ({ project_id, kind, title, category, position }) => {
      const { db } = getDb();
      if (!getProject(db, project_id)) return notFound("project", project_id);
      const created = addItem(
        db,
        {
          projectId: project_id,
          kind,
          title,
          category,
          positionRef: position,
        },
        SOURCE,
      );
      return json({ created, items: listItems(db, project_id) });
    },
  );

  server.registerTool(
    "update_item",
    {
      title: "Update item",
      description: "Patch title/category on an item.",
      inputSchema: {
        id: z.string(),
        title: z.string().optional(),
        category: z.string().nullable().optional(),
      },
    },
    async ({ id, ...patch }) => {
      const { db } = getDb();
      if (!getItem(db, id)) return notFound("item", id);
      return json(updateItem(db, id, patch, SOURCE));
    },
  );

  server.registerTool(
    "complete_item",
    {
      title: "Complete item",
      description:
        "Mark an item as completed. It moves to the upper completed range, sitting closest to the active boundary.",
      inputSchema: { id: z.string() },
    },
    async ({ id }) => {
      const { db } = getDb();
      if (!getItem(db, id)) return notFound("item", id);
      return json(completeItem(db, id, SOURCE));
    },
  );

  server.registerTool(
    "uncomplete_item",
    {
      title: "Uncomplete item",
      description: "Restore a completed item. It lands at the top of the active range.",
      inputSchema: { id: z.string() },
    },
    async ({ id }) => {
      const { db } = getDb();
      if (!getItem(db, id)) return notFound("item", id);
      return json(uncompleteItem(db, id, SOURCE));
    },
  );

  server.registerTool(
    "reorder_item",
    {
      title: "Reorder item",
      description:
        "Move an item within its project. position is top | end | after:<id> | before:<id>.",
      inputSchema: { id: z.string(), position: PosRef },
    },
    async ({ id, position }) => {
      const { db } = getDb();
      if (!getItem(db, id)) return notFound("item", id);
      return json(reorderItem(db, id, position, SOURCE));
    },
  );

  server.registerTool(
    "delete_item",
    {
      title: "Delete item",
      description: "Delete an item.",
      inputSchema: { id: z.string() },
    },
    async ({ id }) => {
      const { db } = getDb();
      deleteItem(db, id, SOURCE);
      return json({ ok: true });
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
      return json(listCategories(db, project_id));
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
      if (!getProject(db, project_id)) return notFound("project", project_id);
      return json(addCategory(db, project_id, name, SOURCE));
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
      const rows = listAudit(db, { projectId: project_id, source, limit });
      return json(
        rows.map(({ ts, ...rest }) => ({
          ts,
          when: formatRelativeLong(ts),
          ...rest,
        })),
      );
    },
  );
}
