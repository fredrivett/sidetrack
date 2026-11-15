import { and, asc, eq, gte, isNotNull, isNull, lte, or, type SQL, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { derivePrefix, dedupePrefix, validatePrefix } from "../lib/itemRef";
import { nestItems } from "../lib/itemTree";
import { normalizeProjectIcon } from "../lib/projectIcon";
import { addDays, dayOf, isOnNoDate, isOnToday } from "../lib/time";
import { normalizeHomepageUrl } from "../lib/url";
import { hasProjectAccess } from "./access";
import { type AuditOrigin, recordAudit } from "./audit";
import type { Db } from "./db";
import { parseProjectRef, resolvePosition } from "./fracidx";
import { listItems } from "./items";
import {
  type Item,
  items,
  type Project,
  PROJECT_STATUSES,
  type ProjectStatus,
  projectPositions,
  projects,
  spaceMembers,
  spaces,
} from "./schema";

/** The acting user's project ordering: {id, position} rows, sorted ascending.
 * One row per project they own or joined directly (owner row at create, member
 * row at accept). A list they see through a Space gets a row only on their
 * first reorder (fillMissingSlots). This is the viewer's board, never anyone
 * else's. */
function viewerPositions(
  db: Db,
  userId: string,
): { id: string; position: string }[] {
  return db
    .select({ id: projectPositions.projectId, position: projectPositions.position })
    .from(projectPositions)
    .where(eq(projectPositions.userId, userId))
    .orderBy(asc(projectPositions.position), asc(projectPositions.projectId))
    .all();
}

/** Position for a project appended to the end of `userId`'s board. Used when a
 * project is created (owner) and when an invite is accepted (member). */
export function nextProjectPosition(db: Db, userId: string): string {
  return resolvePosition(viewerPositions(db, userId), "last");
}

/**
 * The viewer's board, in their own order. A list they can see but have no
 * slot for yet (one shared with them through a Space) sorts at the end, by
 * id, until they first move it (see fillMissingSlots).
 */
export function listProjects(db: Db, userId: string): Project[] {
  return db
    .select({ project: projects })
    .from(projects)
    .leftJoin(
      projectPositions,
      and(
        eq(projectPositions.projectId, projects.id),
        eq(projectPositions.userId, userId),
      ),
    )
    .where(hasProjectAccess(userId))
    .orderBy(
      sql`${projectPositions.position} is null`,
      asc(projectPositions.position),
      asc(projects.id),
    )
    .all()
    .map((r) => r.project);
}

/**
 * Give every list `userId` can see but has no slot for a slot at the end of
 * their board, in the order listProjects shows them, so a reorder can anchor
 * on any list on the board. Space members get no slot when a list joins a
 * Space or they join one; this fills them in on their first drag instead.
 */
// audit-exempt: runs inside reorderProject's audited transaction.
function fillMissingSlots(db: Db, userId: string): void {
  const missing = db
    .select({ id: projects.id })
    .from(projects)
    .leftJoin(
      projectPositions,
      and(
        eq(projectPositions.projectId, projects.id),
        eq(projectPositions.userId, userId),
      ),
    )
    .where(and(hasProjectAccess(userId), isNull(projectPositions.projectId)))
    .orderBy(asc(projects.id))
    .all();
  const board = viewerPositions(db, userId);
  for (const { id } of missing) {
    const position = resolvePosition(board, "last");
    db.insert(projectPositions).values({ userId, projectId: id, position }).run();
    board.push({ id, position });
  }
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
  if (!project) throw new Error(`list not found: ${id}`);
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

/**
 * Up to `perList` open item titles from each active list the user can see,
 * in list order, keyed by list id: a sample of what each list holds. One
 * query for every list, reading only the title column.
 */
export function sampleOpenItemTitles(
  db: Db,
  userId: string,
  perList: number,
): Map<string, string[]> {
  const rows = db
    .select({ projectId: items.projectId, title: items.title })
    .from(items)
    .innerJoin(projects, eq(projects.id, items.projectId))
    .where(
      and(
        hasProjectAccess(userId),
        eq(projects.status, "active"),
        isNull(items.completedAt),
      ),
    )
    .orderBy(asc(items.position), asc(items.id))
    .all();
  const byList = new Map<string, string[]>();
  for (const { projectId, title } of rows) {
    const titles = byList.get(projectId) ?? [];
    if (titles.length < perList) byList.set(projectId, [...titles, title]);
  }
  return byList;
}

/**
 * Items in the user's active lists, in list order, that are open or were
 * finished recently enough to land on `today` in some zone: the 4am start of
 * today is never before midnight UTC the day before, even at UTC+14. The
 * views across lists (Today, No date) narrow this further.
 */
function activeItemsForDay(
  db: Db,
  userId: string,
  today: string,
  ...where: SQL[]
): Item[] {
  return db
    .select({ items })
    .from(items)
    .innerJoin(projects, eq(projects.id, items.projectId))
    .where(
      and(
        hasProjectAccess(userId),
        eq(projects.status, "active"),
        or(
          isNull(items.completedAt),
          gte(items.completedAt, Date.parse(`${addDays(today, -1)}T00:00:00Z`)),
        ),
        ...where,
      ),
    )
    .orderBy(asc(items.position), asc(items.id))
    .all()
    .map((row) => row.items);
}

/**
 * What's due now on the Agenda view, across every active list the user can see: items due on or
 * before `today`, or in a span ("this week") that has started, that are open
 * or were finished today, overdue first, then by
 * board order and list order. Paused and archived lists are left out.
 * `timeZone` decides which day a completion fell on, and the default `today`
 * is the current day there (with the 4am turnover).
 */
export function listToday(
  db: Db,
  userId: string,
  opts: { timeZone?: string; today?: string; now?: number } = {},
): { today: string; items: Item[] } {
  const today = opts.today ?? dayOf(opts.now ?? Date.now(), opts.timeZone);
  const boardOrder = new Map(
    listProjects(db, userId)
      .filter((p) => p.status === "active")
      .map((p, i) => [p.id, i]),
  );
  const due = activeItemsForDay(
    db,
    userId,
    today,
    isNotNull(items.dueDate),
    // Started: a span ("this week") is on Today from its first day.
    lte(sql`coalesce(${items.dueFrom}, ${items.dueDate})`, today),
  ).filter((it) => isOnToday(it, today, opts.timeZone));
  // Stable sort: due date, then the list's place on the board; ties keep list order.
  due.sort(
    (a, b) =>
      (a.dueDate ?? "").localeCompare(b.dueDate ?? "") ||
      (boardOrder.get(a.projectId) ?? 0) - (boardOrder.get(b.projectId) ?? 0),
  );
  return { today, items: due };
}

/**
 * The Agenda view's No date section, across every active list the user can see: tasks with no
 * due date that are open or were finished today (see isOnNoDate), grouped by
 * list in board order, each list's items in list order (a parent, then its
 * sub-items). Lists with nothing undated are left out, as are paused and archived lists. A sub-item
 * of a dated parent is planned with its parent, so stays out. `timeZone` and
 * `today` work as in listToday.
 */
export function listNoDate(
  db: Db,
  userId: string,
  opts: { timeZone?: string; today?: string; now?: number } = {},
): { today: string; lists: Array<{ project: Project; items: Item[] }> } {
  const today = opts.today ?? dayOf(opts.now ?? Date.now(), opts.timeZone);
  // Dated items too: a sub-item's place here depends on its parent's date.
  const rows = activeItemsForDay(db, userId, today);
  const byId = new Map(rows.map((it) => [it.id, it]));
  const undated = rows.filter((it) =>
    isOnNoDate(
      it,
      it.parentId ? byId.get(it.parentId) : undefined,
      today,
      opts.timeZone,
    ),
  );
  const lists = listProjects(db, userId)
    .filter((p) => p.status === "active")
    .map((project) => ({
      project,
      // Sub-item positions are scoped to their parent, so list each parent
      // followed by its sub-items.
      items: nestItems(undated.filter((it) => it.projectId === project.id)).flatMap(
        ({ children, ...it }) => [it, ...children],
      ),
    }))
    .filter((l) => l.items.length > 0);
  return { today, lists };
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
  if (!trimmed) throw new Error("list name cannot be empty");
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

/** A Space `userId` has accepted, or a plain not-found (as spaces.ts says). */
function joinedSpace(db: Db, userId: string, spaceId: string) {
  const space = db
    .select({ id: spaces.id, name: spaces.name })
    .from(spaces)
    .innerJoin(spaceMembers, eq(spaceMembers.spaceId, spaces.id))
    .where(
      and(
        eq(spaces.id, spaceId),
        eq(spaceMembers.userId, userId),
        eq(spaceMembers.status, "accepted"),
      ),
    )
    .get();
  if (!space) throw new Error(`space not found: ${spaceId}`);
  return space;
}

export function createProject(
  db: Db,
  userId: string,
  input: {
    name: string;
    status?: ProjectStatus;
    summary?: string;
    homepageUrl?: string | null;
    icon?: string | null;
    /** A Space the creator has joined, to share the new list with. */
    spaceId?: string | null;
  },
  source: AuditOrigin,
): Project {
  const status = input.status ?? "active";
  const space = input.spaceId ? joinedSpace(db, userId, input.spaceId) : null;
  assertStatus(status);
  const position = nextProjectPosition(db, userId);
  const id = nanoid(12);
  const now = Date.now();
  const name = assertName(input.name);
  const prefix = ensureUniquePrefix(db, userId, derivePrefix(name));
  // Optional details, validated the same way updateProject validates them;
  // blank means unset.
  const summary = input.summary?.trim() ?? "";
  const homepageUrl = input.homepageUrl
    ? normalizeHomepageUrl(input.homepageUrl)
    : null;
  const icon = input.icon ? normalizeProjectIcon(input.icon) : null;
  db.transaction((tx) => {
    tx.insert(projects)
      .values({
        id,
        userId,
        name,
        status,
        prefix,
        summary,
        summaryUpdatedAt: summary ? now : null,
        homepageUrl,
        icon,
        spaceId: space?.id ?? null,
        createdAt: now,
      })
      .run();
    tx.insert(projectPositions).values({ userId, projectId: id, position }).run();
    recordAudit(tx as unknown as Db, {
      actor: userId,
      source,
      action: "create",
      entityType: "project",
      entityId: id,
      projectId: id,
      detail: space
        ? `created list "${name}" in space "${space.name}"`
        : `created list "${name}"`,
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
  source: AuditOrigin,
): Project {
  const existing = getProject(db, userId, id);
  if (!existing) throw new Error(`list not found: ${id}`);
  // getProject authorizes any member; the editable fields below (name, status,
  // summary, homepage) are open to members, but the prefix is owner-only.
  const isOwner = existing.userId === userId;

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
      // The prefix is the owner's item-ID namespace — owner-only. Reject a
      // member's change loudly rather than letting the write silently no-op.
      if (!isOwner) {
        throw new Error("only the list owner can change the prefix");
      }
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
    // Access was authorized by getProject above (and prefix changes are
    // owner-gated), so filter by id alone — matching how item mutations trust
    // their getItem precheck rather than re-scoping the write.
    tx.update(projects).set(next).where(eq(projects.id, id)).run();
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
  source: AuditOrigin,
): Project {
  const existing = getProject(db, userId, id);
  if (!existing) throw new Error(`list not found: ${id}`);
  const ref = parseProjectRef(refRaw);
  db.transaction((tx) => {
    fillMissingSlots(tx as unknown as Db, userId);
    const others = viewerPositions(tx as unknown as Db, userId).filter(
      (p) => p.id !== id,
    );
    const position = resolvePosition(others, ref);
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
      detail: `reordered list "${existing.name}"`,
    });
  });
  return getProjectOrThrow(db, userId, id);
}

export function deleteProject(
  db: Db,
  userId: string,
  id: string,
  source: AuditOrigin,
): void {
  const existing = getProject(db, userId, id);
  if (!existing) return;
  // Deleting is owner-only. getProject authorizes members too, so reject a
  // member explicitly rather than letting the delete silently no-op while still
  // writing a "deleted project" audit row. (Members leave via removeMember.)
  if (existing.userId !== userId) {
    throw new Error("only the list owner can delete the list");
  }
  db.transaction((tx) => {
    tx.delete(projects).where(eq(projects.id, id)).run();
    recordAudit(tx as unknown as Db, {
      actor: userId,
      source,
      action: "delete",
      entityType: "project",
      entityId: id,
      projectId: id,
      detail: `deleted list "${existing.name}"`,
    });
  });
}
