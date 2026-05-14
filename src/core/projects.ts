import { asc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { Db } from "./db";
import {
  type ProjectPositionRef,
  parseProjectRef,
  resolveProjectPosition,
} from "./fracidx";
import { listItems } from "./items";
import {
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
): Project {
  const status = input.status ?? "idea";
  assertStatus(status);
  const all = listProjects(db);
  const position = resolveProjectPosition(all, "end");
  const id = nanoid(12);
  const now = Date.now();
  db.insert(projects)
    .values({
      id,
      name: input.name.trim(),
      status,
      position,
      createdAt: now,
    })
    .run();
  return getProject(db, id)!;
}

export function updateProject(
  db: Db,
  id: string,
  patch: { name?: string; status?: ProjectStatus; summary?: string },
): Project {
  const existing = getProject(db, id);
  if (!existing) throw new Error(`project not found: ${id}`);

  const next: Partial<Project> = {};
  if (patch.name !== undefined) next.name = patch.name.trim();
  if (patch.status !== undefined) {
    assertStatus(patch.status);
    next.status = patch.status;
  }
  if (patch.summary !== undefined) {
    next.summary = patch.summary;
    next.summaryUpdatedAt = Date.now();
  }
  if (Object.keys(next).length === 0) return existing;

  db.update(projects).set(next).where(eq(projects.id, id)).run();
  return getProject(db, id)!;
}

export function reorderProject(
  db: Db,
  id: string,
  refRaw: string,
): Project {
  const existing = getProject(db, id);
  if (!existing) throw new Error(`project not found: ${id}`);
  const ref = parseProjectRef(refRaw) as ProjectPositionRef;
  const others = listProjects(db).filter((p) => p.id !== id);
  const position = resolveProjectPosition(others, ref);
  db.update(projects).set({ position }).where(eq(projects.id, id)).run();
  return getProject(db, id)!;
}

export function deleteProject(db: Db, id: string): void {
  db.delete(projects).where(eq(projects.id, id)).run();
}
