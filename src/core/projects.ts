import { and, asc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { derivePrefix, dedupePrefix, validatePrefix } from "../lib/itemRef";
import { normalizeProjectIcon } from "../lib/projectIcon";
import { normalizeHomepageUrl } from "../lib/url";
import { hasProjectAccess } from "./access";
import { recordAudit } from "./audit";
import type { Db } from "./db";
import {
  type ProjectPositionRef,
  parseProjectRef,
  resolveProjectPosition,
} from "./fracidx";
import { listItems } from "./items";
import {
  type AuditSource,
  type Project,
  PROJECT_STATUSES,
  type ProjectStatus,
  projectPositions,
  projects,
} from "./schema";

/** The acting user's project ordering: {id, position} rows, sorted ascending.
 * One row per project they can see (owner row at create, member row at accept),
 * so this is the viewer's board — never anyone else's. */
function viewerPositions(
  db: Db,
  userId: string,
): { id: string; position: string }[] {
  return db
    .select({ id: projectPositions.projectId, position: projectPositions.position })
    .from(projectPositions)
    .where(eq(projectPositions.userId, userId))
    .orderBy(asc(projectPositions.position))
    .all();
}

/** Position for a project appended to the end of `userId`'s board. Used when a
 * project is created (owner) and when an invite is accepted (member). */
export function nextProjectPosition(db: Db, userId: string): string {
  return resolveProjectPosition(viewerPositions(db, userId), "end");
}

export function listProjects(db: Db, userId: string): Project[] {
  return db
    .select({ project: projects })
    .from(projects)
    .innerJoin(
      projectPositions,
      and(
        eq(projectPositions.projectId, projects.id),
        eq(projectPositions.userId, userId),
      ),
    )
    .where(hasProjectAccess(userId))
    .orderBy(asc(projectPositions.position))
    .all()
    .map((r) => r.project);
}

export function getProject(
  db: Db,
  userId: string,
  id: string,
): Project | undefined {
  return db
    .select()
    .from(projects)
    .where(and(eq(projects.id, id), hasProjectAccess(userId)))
    .get();
}

/**
 * Read a project back after a mutation that just created or updated it inside
 * the same transaction. The row is guaranteed to exist; a miss means an
 * invariant broke, so fail loudly rather than handing back `undefined`.
 */
function getProjectOrThrow(db: Db, userId: string, id: string): Project {
  const project = getProject(db, userId, id);
  if (!project) throw new Error(`project not found: ${id}`);
  return project;
}

export function getProjectWithItems(
  db: Db,
  userId: string,
  id: string,
  opts: { includeCompleted?: boolean } = {},
) {
  const project = getProject(db, userId, id);
  if (!project) return undefined;
  const items = listItems(db, userId, id, {
    includeCompleted: opts.includeCompleted,
  });
  return { project, items };
}

export function listAllProjectsWithItems(
  db: Db,
  userId: string,
  opts: { includeCompleted?: boolean } = {},
) {
  return listProjects(db, userId).map((project) => ({
    project,
    items: listItems(db, userId, project.id, {
      includeCompleted: opts.includeCompleted,
    }),
  }));
}

function assertStatus(status: string): asserts status is ProjectStatus {
  if (!(PROJECT_STATUSES as readonly string[]).includes(status)) {
    throw new Error(`invalid status: ${status}`);
  }
}

// A nameless project is unusable; reject blank at the boundary (web or MCP)
// and return the trimmed value.
function assertName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("project name cannot be empty");
  return trimmed;
}

/**
 * Resolve a base prefix to one unique within the owner's namespace, auto-
 * suffixing on collision (`ENG` → `ENG2`). Scoped to the owner's *own* projects
 * — matching the `(user_id, prefix)` unique index — NOT the access-scoped
 * listProjects: a member may independently own an `ENG` while a shared `ENG` is
 * on their board, and that intentional clash is what the qualified ref
 * (`owner/ENG-42`) disambiguates. This keeps creation from ever hard-failing.
 */
function ensureUniquePrefix(
  db: Db,
  userId: string,
  base: string,
  excludeId?: string,
): string {
  const owned = db
    .select({ id: projects.id, prefix: projects.prefix })
    .from(projects)
    .where(eq(projects.userId, userId))
    .all();
  const taken = new Set(
    owned.filter((p) => p.id !== excludeId).map((p) => p.prefix),
  );
  return dedupePrefix(base, taken);
}

export function createProject(
  db: Db,
  userId: string,
  input: { name: string; status?: ProjectStatus },
  source: AuditSource,
): Project {
  const status = input.status ?? "idea";
  assertStatus(status);
  const position = nextProjectPosition(db, userId);
  const id = nanoid(12);
  const now = Date.now();
  const name = assertName(input.name);
  const prefix = ensureUniquePrefix(db, userId, derivePrefix(name));
  db.transaction((tx) => {
    tx.insert(projects)
      .values({ id, userId, name, status, prefix, createdAt: now })
      .run();
    tx.insert(projectPositions).values({ userId, projectId: id, position }).run();
    recordAudit(tx as unknown as Db, {
      actor: userId,
      source,
      action: "create",
      entityType: "project",
      entityId: id,
      projectId: id,
      detail: `created project "${name}"`,
    });
  });
  return getProjectOrThrow(db, userId, id);
}

export function updateProject(
  db: Db,
  userId: string,
  id: string,
  patch: {
    name?: string;
    status?: ProjectStatus;
    summary?: string;
    prefix?: string;
    homepageUrl?: string | null;
    icon?: string | null;
  },
  source: AuditSource,
): Project {
  const existing = getProject(db, userId, id);
  if (!existing) throw new Error(`project not found: ${id}`);

  const next: Partial<Project> = {};
  const changes: string[] = [];
  if (patch.name !== undefined) {
    const name = assertName(patch.name);
    if (name !== existing.name) {
      next.name = name;
      changes.push(`renamed to "${name}"`);
    }
  }
  if (patch.prefix !== undefined) {
    const normalized = patch.prefix.trim().toUpperCase();
    const err = validatePrefix(normalized);
    if (err) throw new Error(`invalid prefix: ${err}`);
    if (normalized !== existing.prefix) {
      // Auto-suffix on collision rather than reject, matching create. The ref
      // is derived display data, so changing the prefix never renumbers items
      // or touches the nanoid PK — it's a pure display change.
      const unique = ensureUniquePrefix(db, userId, normalized, id);
      next.prefix = unique;
      changes.push(`prefix ${existing.prefix}→${unique}`);
    }
  }
  if (patch.status !== undefined && patch.status !== existing.status) {
    assertStatus(patch.status);
    next.status = patch.status;
    changes.push(`status ${existing.status}→${patch.status}`);
  }
  if (patch.summary !== undefined && patch.summary !== existing.summary) {
    next.summary = patch.summary;
    next.summaryUpdatedAt = Date.now();
    changes.push("edited summary");
  }
  if (patch.homepageUrl !== undefined) {
    const normalized =
      patch.homepageUrl === null
        ? null
        : normalizeHomepageUrl(patch.homepageUrl);
    if (normalized !== existing.homepageUrl) {
      next.homepageUrl = normalized;
      changes.push(
        normalized === null
          ? "cleared homepage"
          : existing.homepageUrl
            ? "edited homepage"
            : "set homepage",
      );
    }
  }
  if (patch.icon !== undefined) {
    const normalized =
      patch.icon === null ? null : normalizeProjectIcon(patch.icon);
    if (normalized !== existing.icon) {
      next.icon = normalized;
      changes.push(
        normalized === null
          ? "cleared icon"
          : existing.icon
            ? "changed icon"
            : "set icon",
      );
    }
  }
  if (Object.keys(next).length === 0) return existing;

  db.transaction((tx) => {
    tx.update(projects)
      .set(next)
      .where(and(eq(projects.id, id), eq(projects.userId, userId)))
      .run();
    recordAudit(tx as unknown as Db, {
      actor: userId,
      source,
      action: "update",
      entityType: "project",
      entityId: id,
      projectId: id,
      detail: `${existing.name}: ${changes.join(", ")}`,
    });
  });
  return getProjectOrThrow(db, userId, id);
}

export function reorderProject(
  db: Db,
  userId: string,
  id: string,
  refRaw: string,
  source: AuditSource,
): Project {
  const existing = getProject(db, userId, id);
  if (!existing) throw new Error(`project not found: ${id}`);
  const ref = parseProjectRef(refRaw) as ProjectPositionRef;
  const others = viewerPositions(db, userId).filter((p) => p.id !== id);
  const position = resolveProjectPosition(others, ref);
  db.transaction((tx) => {
    // Reordering moves the project only on the acting user's board — update
    // their own position row, never the owner's or another member's.
    tx.update(projectPositions)
      .set({ position })
      .where(
        and(
          eq(projectPositions.userId, userId),
          eq(projectPositions.projectId, id),
        ),
      )
      .run();
    recordAudit(tx as unknown as Db, {
      actor: userId,
      source,
      action: "reorder",
      entityType: "project",
      entityId: id,
      projectId: id,
      detail: `reordered project "${existing.name}"`,
    });
  });
  return getProjectOrThrow(db, userId, id);
}

export function deleteProject(
  db: Db,
  userId: string,
  id: string,
  source: AuditSource,
): void {
  const existing = getProject(db, userId, id);
  if (!existing) return;
  db.transaction((tx) => {
    tx.delete(projects)
      .where(and(eq(projects.id, id), eq(projects.userId, userId)))
      .run();
    recordAudit(tx as unknown as Db, {
      actor: userId,
      source,
      action: "delete",
      entityType: "project",
      entityId: id,
      projectId: id,
      detail: `deleted project "${existing.name}"`,
    });
  });
}
