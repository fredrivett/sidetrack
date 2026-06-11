import { nanoid } from "nanoid";
import { beforeEach, describe, expect, it } from "vitest";
import { listAudit } from "./audit";
import { addCategory, listCategories } from "./categories";
import { createTestDb, createTestUser } from "./test-helpers";
import { addItem, getItem, listItems } from "./items";
import {
  createProject,
  getProject,
  getProjectWithItems,
  listProjects,
} from "./projects";
import { projectMembers } from "./schema";

type Db = ReturnType<typeof createTestDb>["db"];

// Insert a membership row directly. There is no addMember core fn yet (that's
// the next step); this exercises the hasProjectAccess seam on its own.
function addMember(db: Db, projectId: string, userId: string) {
  db.insert(projectMembers)
    .values({ id: nanoid(12), projectId, userId })
    .run();
}

describe("project access (owner + members)", () => {
  let db: Db;
  let owner: string;
  let member: string;
  let stranger: string;

  beforeEach(() => {
    db = createTestDb().db;
    owner = createTestUser(db, { email: "owner@test.local" });
    member = createTestUser(db, { email: "member@test.local" });
    stranger = createTestUser(db, { email: "stranger@test.local" });
  });

  it("with no member rows, access is owner-only (the no-op baseline)", () => {
    const p = createProject(db, owner, { name: "Solo" }, "web");
    expect(getProject(db, owner, p.id)?.id).toBe(p.id);
    expect(getProject(db, member, p.id)).toBeUndefined();
    expect(listProjects(db, member)).toHaveLength(0);
  });

  it("a member can read the project and its items; a stranger cannot", () => {
    const p = createProject(db, owner, { name: "Shared" }, "web");
    addItem(db, owner, { projectId: p.id, kind: "task", title: "T1" }, "web");
    addMember(db, p.id, member);

    expect(getProject(db, member, p.id)?.id).toBe(p.id);
    expect(listProjects(db, member).map((x) => x.id)).toContain(p.id);
    expect(listItems(db, member, p.id).map((i) => i.title)).toEqual(["T1"]);
    expect(getProjectWithItems(db, member, p.id)?.items).toHaveLength(1);

    expect(getProject(db, stranger, p.id)).toBeUndefined();
    expect(listProjects(db, stranger)).toHaveLength(0);
    expect(listItems(db, stranger, p.id)).toHaveLength(0);
  });

  it("a member can edit: add items and categories", () => {
    const p = createProject(db, owner, { name: "Shared" }, "web");
    addMember(db, p.id, member);

    const item = addItem(
      db,
      member,
      { projectId: p.id, kind: "task", title: "By member" },
      "web",
    );
    expect(getItem(db, owner, item.id)?.title).toBe("By member");

    addCategory(db, member, p.id, "infra", "web");
    expect(listCategories(db, owner, p.id).map((c) => c.name)).toContain(
      "infra",
    );
  });

  it("a member sees the project's audit history; a stranger does not", () => {
    const p = createProject(db, owner, { name: "Shared" }, "web");
    addMember(db, p.id, member);

    expect(listAudit(db, member, { projectId: p.id }).length).toBeGreaterThan(0);
    expect(listAudit(db, stranger, { projectId: p.id })).toHaveLength(0);

    // All-projects view picks up the shared project for the member.
    expect(
      listAudit(db, member).some((e) => e.projectId === p.id),
    ).toBe(true);
  });
});
