import { asc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
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
  projects,
} from "./schema";

export function listProjects(db: Db): Project[] {
  return db.select().from(projects).orderBy(asc(projects.position)).all();
}

export function getProject(db: Db, id: string): Project | undefined {
  return db.select().from(projects).where(eq(projects.id, id)).get();
}

export function getProjectWithItems(
  db: Db,
  id: string,
  opts: { includeCompleted?: boolean } = {},
) {
  const project = getProject(db, id);
  if (!project) return undefined;
  const items = listItems(db, id, { includeCompleted: opts.includeCompleted });
  return { project, items };
}

function assertStatus(status: string): asserts status is ProjectStatus {
  if (!(PROJECT_STATUSES as readonly string[]).includes(status)) {
    throw new Error(`invalid status: ${status}`);
  }
}

export function createProject(
  db: Db,
  input: { name: string; status?: ProjectStatus },
  source: AuditSource,
): Project {
  const status = input.status ?? "idea";
  assertStatus(status);
  const all = listProjects(db);
  const position = resolveProjectPosition(all, "end");
  const id = nanoid(12);
  const now = Date.now();
  const name = input.name.trim();
  db.transaction((tx) => {
    tx.insert(projects)
      .values({ id, name, status, position, createdAt: now })
      .run();
    recordAudit(tx as unknown as Db, {
      source,
      action: "create",
      entityType: "project",
      entityId: id,
      projectId: id,
      detail: `created project "${name}"`,
    });
  });
  return getProject(db, id)!;
}

export function updateProject(
  db: Db,
  id: string,
  patch: { name?: string; status?: ProjectStatus; summary?: string },
  source: AuditSource,
): Project {
  const existing = getProject(db, id);
  if (!existing) throw new Error(`project not found: ${id}`);

  const next: Partial<Project> = {};
  const changes: string[] = [];
  if (patch.name !== undefined && patch.name.trim() !== existing.name) {
    next.name = patch.name.trim();
    changes.push(`renamed to "${next.name}"`);
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
  if (Object.keys(next).length === 0) return existing;

  db.transaction((tx) => {
    tx.update(projects).set(next).where(eq(projects.id, id)).run();
    recordAudit(tx as unknown as Db, {
      source,
      action: "update",
      entityType: "project",
      entityId: id,
      projectId: id,
      detail: `${existing.name}: ${changes.join(", ")}`,
    });
  });
  return getProject(db, id)!;
}

export function reorderProject(
  db: Db,
  id: string,
  refRaw: string,
  source: AuditSource,
): Project {
  const existing = getProject(db, id);
  if (!existing) throw new Error(`project not found: ${id}`);
  const ref = parseProjectRef(refRaw) as ProjectPositionRef;
  const others = listProjects(db).filter((p) => p.id !== id);
  const position = resolveProjectPosition(others, ref);
  db.transaction((tx) => {
    tx.update(projects).set({ position }).where(eq(projects.id, id)).run();
    recordAudit(tx as unknown as Db, {
      source,
      action: "reorder",
      entityType: "project",
      entityId: id,
      projectId: id,
      detail: `reordered project "${existing.name}"`,
    });
  });
  return getProject(db, id)!;
}

export function deleteProject(db: Db, id: string, source: AuditSource): void {
  const existing = getProject(db, id);
  if (!existing) return;
  db.transaction((tx) => {
    tx.delete(projects).where(eq(projects.id, id)).run();
    recordAudit(tx as unknown as Db, {
      source,
      action: "delete",
      entityType: "project",
      entityId: id,
      projectId: id,
      detail: `deleted project "${existing.name}"`,
    });
  });
}
