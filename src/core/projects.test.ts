import { describe, expect, it } from "vitest";
import { listAudit } from "./audit";
import { addItem, completeItem, listItems } from "./items";
import {
  createProject,
  deleteProject,
  getProject,
  listProjects,
  reorderProject,
  sampleOpenItemTitles,
  updateProject,
} from "./projects";
import { createTestDb, createTestUser } from "./test-helpers";

describe("projects", () => {
  it("creates projects in insertion order at the end", () => {
    const { db } = createTestDb();
    const u = createTestUser(db);
    createProject(db, u, { name: "A" }, "web");
    createProject(db, u, { name: "B" }, "mcp");
    createProject(db, u, { name: "C" }, "web");
    expect(listProjects(db, u).map((p) => p.name)).toEqual(["A", "B", "C"]);
  });

  it("starts lists active, archives them with their items, and rejects old launch statuses", () => {
    const { db } = createTestDb();
    const u = createTestUser(db);
    const p = createProject(db, u, { name: "Christmas trip" }, "web");
    expect(p.status).toBe("active");
    addItem(db, u, { projectId: p.id, title: "Book trains" }, "web");

    updateProject(db, u, p.id, { status: "archived" }, "web");
    expect(getProject(db, u, p.id)?.status).toBe("archived");
    expect(listItems(db, u, p.id).map((i) => i.title)).toEqual(["Book trains"]);
    expect(listAudit(db, u)[0].detail).toBe(
      'Christmas trip: status active→archived',
    );

    expect(() =>
      updateProject(db, u, p.id, { status: "launched" as never }, "web"),
    ).toThrow(/invalid status/);
  });

  it("creates a list with optional details, validated as on update, in one audit row", () => {
    const { db } = createTestDb();
    const u = createTestUser(db);
    const p = createProject(
      db,
      u,
      {
        name: "Personal site",
        summary: "  Blog and portfolio ",
        homepageUrl: "example.com",
        icon: "🌐",
      },
      "web",
    );
    expect(p).toMatchObject({
      summary: "Blog and portfolio",
      homepageUrl: "https://example.com/",
      icon: "🌐",
    });
    expect(p.summaryUpdatedAt).not.toBeNull();
    expect(listAudit(db, u).map((a) => a.detail)).toEqual([
      'created list "Personal site"',
    ]);

    // Blank details mean unset; a bad one rejects the whole create.
    const bare = createProject(
      db,
      u,
      { name: "Bare", summary: " ", homepageUrl: "", icon: "" },
      "web",
    );
    expect(bare).toMatchObject({
      summary: "",
      summaryUpdatedAt: null,
      homepageUrl: null,
      icon: null,
    });
    expect(() =>
      createProject(db, u, { name: "Bad", icon: "not an icon" }, "web"),
    ).toThrow(/invalid list icon/);
    expect(() =>
      createProject(db, u, { name: "Bad", homepageUrl: "not a url" }, "web"),
    ).toThrow(/invalid homepage URL/);
    expect(listProjects(db, u).map((p) => p.name)).toEqual([
      "Personal site",
      "Bare",
    ]);
  });

  it("samples each active list's open titles in list order, up to the cap", () => {
    const { db } = createTestDb();
    const u = createTestUser(db);
    const home = createProject(db, u, { name: "Home" }, "web");
    const trip = createProject(db, u, { name: "Trip" }, "web");
    const archived = createProject(db, u, { name: "Someday" }, "web");
    for (const title of ["Water plants", "Descale", "Mow lawn"]) {
      addItem(db, u, { projectId: home.id, title }, "web");
    }
    const done = addItem(db, u, { projectId: trip.id, title: "Book flights" }, "web");
    completeItem(db, u, done.id, "web");
    addItem(db, u, { projectId: trip.id, title: "Pack" }, "web");
    addItem(db, u, { projectId: archived.id, title: "Learn piano" }, "web");
    updateProject(db, u, archived.id, { status: "archived" }, "web");

    expect(Object.fromEntries(sampleOpenItemTitles(db, u, 2))).toEqual({
      [home.id]: ["Water plants", "Descale"],
      [trip.id]: ["Pack"],
    });
  });

  it("rejects a blank name on create", () => {
    const { db } = createTestDb();
    const u = createTestUser(db);
    expect(() => createProject(db, u, { name: "   " }, "web")).toThrow(
      /name cannot be empty/,
    );
  });

  it("rejects clearing the name on update and leaves it unchanged", () => {
    const { db } = createTestDb();
    const u = createTestUser(db);
    const p = createProject(db, u, { name: "keep me" }, "web");
    expect(() => updateProject(db, u, p.id, { name: " " }, "web")).toThrow(
      /name cannot be empty/,
    );
    expect(getProject(db, u, p.id)?.name).toBe("keep me");
  });

  it("reorders a project after another", () => {
    const { db } = createTestDb();
    const u = createTestUser(db);
    const a = createProject(db, u, { name: "A" }, "web");
    createProject(db, u, { name: "B" }, "web");
    const c = createProject(db, u, { name: "C" }, "web");

    reorderProject(db, u, c.id, "after:" + a.id, "web");
    expect(listProjects(db, u).map((p) => p.name)).toEqual(["A", "C", "B"]);
    reorderProject(db, u, c.id, "start", "web");
    expect(listProjects(db, u).map((p) => p.name)).toEqual(["C", "A", "B"]);
  });

  it("threads source through to audit", () => {
    const { db } = createTestDb();
    const u = createTestUser(db);
    const p = createProject(db, u, { name: "X" }, "mcp");
    const entry = listAudit(db, u).find(
      (e) => e.entityType === "project" && e.entityId === p.id,
    );
    expect(entry?.source).toBe("mcp");
    expect(entry?.action).toBe("create");
  });

  it("keeps audit rows after the project is deleted (no cascade)", () => {
    const { db } = createTestDb();
    const u = createTestUser(db);
    const p = createProject(db, u, { name: "Doomed" }, "web");
    deleteProject(db, u, p.id, "web");

    // The project-scoped view can't authorize a now-deleted project, but the
    // rows survive (no cascade) and stay visible in the owner's all-projects
    // feed via the actor fallback — so the deletion itself remains auditable.
    expect(listAudit(db, u, { projectId: p.id })).toEqual([]);
    const rows = listAudit(db, u).filter((r) => r.entityId === p.id);
    const actions = rows.map((r) => r.action).sort();
    expect(actions).toEqual(["create", "delete"]);
  });

  it("derives a prefix from the name on create", () => {
    const { db } = createTestDb();
    const u = createTestUser(db);
    const p = createProject(db, u, { name: "Sidetrack" }, "web");
    expect(p.prefix).toBe("SID");
  });

  it("auto-suffixes a colliding prefix within an owner", () => {
    const { db } = createTestDb();
    const u = createTestUser(db);
    const a = createProject(db, u, { name: "Sidetrack" }, "web");
    const b = createProject(db, u, { name: "Sidequest" }, "web");
    expect(a.prefix).toBe("SID");
    expect(b.prefix).toBe("SID2");
  });

  it("lets different owners share a prefix", () => {
    const { db } = createTestDb();
    const alice = createTestUser(db, { email: "alice@test.local" });
    const bob = createTestUser(db, { email: "bob@test.local" });
    const a = createProject(db, alice, { name: "Engineering" }, "web");
    const b = createProject(db, bob, { name: "Engineering" }, "web");
    expect(a.prefix).toBe("ENG");
    expect(b.prefix).toBe("ENG");
  });

  it("edits the prefix (uppercased), audits it, and rejects bad input", () => {
    const { db } = createTestDb();
    const u = createTestUser(db);
    const p = createProject(db, u, { name: "Sidetrack" }, "web");

    const updated = updateProject(db, u, p.id, { prefix: "plt" }, "web");
    expect(updated.prefix).toBe("PLT");
    const entry = listAudit(db, u).find(
      (e) => e.entityId === p.id && e.detail.includes("prefix"),
    );
    expect(entry?.detail).toContain("SID→PLT");

    expect(() => updateProject(db, u, p.id, { prefix: "x" }, "web")).toThrow(
      /invalid prefix/,
    );
  });

  it("audits moving done items to Done and undoing it, but not a repeat or a future time", () => {
    const { db } = createTestDb();
    const u = createTestUser(db);
    const p = createProject(db, u, { name: "Trip" }, "web");
    const audits = () =>
      listAudit(db, u, { projectId: p.id }).filter((a) => a.action === "update");

    expect(updateProject(db, u, p.id, { doneClearedAt: 2000 }, "web").doneClearedAt).toBe(2000);
    updateProject(db, u, p.id, { doneClearedAt: 2000 }, "web");
    expect(() =>
      updateProject(db, u, p.id, { doneClearedAt: Date.now() + 60_000 }, "web"),
    ).toThrow(/invalid done-cleared time/);
    // Undoing a list's first tidy puts back null.
    expect(updateProject(db, u, p.id, { doneClearedAt: null }, "web").doneClearedAt).toBeNull();
    expect(audits().map((a) => a.detail).reverse()).toEqual([
      "Trip: moved done items to Done",
      "Trip: moved done items back to the list",
    ]);
  });

  it("auto-suffixes a colliding prefix on edit", () => {
    const { db } = createTestDb();
    const u = createTestUser(db);
    createProject(db, u, { name: "Engineering" }, "web");
    const b = createProject(db, u, { name: "Marketing" }, "web");
    const updated = updateProject(db, u, b.id, { prefix: "ENG" }, "web");
    expect(updated.prefix).toBe("ENG2");
  });

  it("normalizes and audits a homepage URL, then clears it", () => {
    const { db } = createTestDb();
    const u = createTestUser(db);
    const p = createProject(db, u, { name: "Sidetrack" }, "web");

    // A bare host gains an https:// scheme on the way in.
    const set = updateProject(
      db,
      u,
      p.id,
      { homepageUrl: "sidetrack.it" },
      "web",
    );
    expect(set.homepageUrl).toBe("https://sidetrack.it/");
    expect(
      listAudit(db, u).find((e) => e.detail.includes("set homepage")),
    ).toBeTruthy();

    // null clears it and audits the clear.
    const cleared = updateProject(
      db,
      u,
      p.id,
      { homepageUrl: null },
      "web",
    );
    expect(cleared.homepageUrl).toBeNull();
    expect(
      listAudit(db, u).find((e) => e.detail.includes("cleared homepage")),
    ).toBeTruthy();
  });

  it("rejects an invalid homepage URL and leaves the project unchanged", () => {
    const { db } = createTestDb();
    const u = createTestUser(db);
    const p = createProject(db, u, { name: "Sidetrack" }, "web");
    expect(() =>
      updateProject(db, u, p.id, { homepageUrl: "not a url" }, "web"),
    ).toThrow(/invalid homepage URL/);
    expect(getProject(db, u, p.id)?.homepageUrl).toBeNull();
  });

  it("stores a pasted GitHub URL as owner/repo, audits it, then clears it", () => {
    const { db } = createTestDb();
    const u = createTestUser(db);
    const p = createProject(db, u, { name: "Sidetrack" }, "web");

    const set = updateProject(
      db,
      u,
      p.id,
      { repository: "https://github.com/fredrivett/sidetrack.git" },
      "web",
    );
    expect(set.repository).toBe("fredrivett/sidetrack");
    expect(listAudit(db, u)[0].detail).toBe(
      "Sidetrack: set repository to fredrivett/sidetrack",
    );
    // The same repository pasted differently changes nothing, so isn't logged.
    const logged = listAudit(db, u).length;
    updateProject(db, u, p.id, { repository: "fredrivett/sidetrack" }, "web");
    expect(listAudit(db, u).length).toBe(logged);

    expect(() =>
      updateProject(db, u, p.id, { repository: "gitlab.com/a/b" }, "web"),
    ).toThrow(/invalid repository/);
    updateProject(db, u, p.id, { repository: "fredrivett/abode" }, "web");
    expect(listAudit(db, u)[0].detail).toBe(
      "Sidetrack: repository fredrivett/sidetrack→fredrivett/abode",
    );
    expect(updateProject(db, u, p.id, { repository: null }, "web").repository).toBeNull();
    expect(listAudit(db, u)[0].detail).toBe("Sidetrack: cleared repository fredrivett/abode");
  });

  it("sets an emoji icon, normalizes an image-URL icon, then clears it", () => {
    const { db } = createTestDb();
    const u = createTestUser(db);
    const p = createProject(db, u, { name: "Sidetrack" }, "web");

    const emoji = updateProject(db, u, p.id, { icon: "🚀" }, "web");
    expect(emoji.icon).toBe("🚀");
    expect(
      listAudit(db, u).find((e) => e.detail.includes("set icon")),
    ).toBeTruthy();

    const image = updateProject(
      db,
      u,
      p.id,
      { icon: "cdn.example.com/logo.png" },
      "web",
    );
    expect(image.icon).toBe("https://cdn.example.com/logo.png");
    expect(
      listAudit(db, u).find((e) => e.detail.includes("changed icon")),
    ).toBeTruthy();

    const cleared = updateProject(db, u, p.id, { icon: null }, "web");
    expect(cleared.icon).toBeNull();
    expect(
      listAudit(db, u).find((e) => e.detail.includes("cleared icon")),
    ).toBeTruthy();
  });

  it("follows a suggested icon until someone chooses one, even none", () => {
    const { db } = createTestDb();
    const u = createTestUser(db);
    const p = createProject(db, u, { name: "Gym", icon: "🏋️", iconChosen: false }, "web");
    expect(p).toMatchObject({ icon: "🏋️", iconChosen: false });

    // A newer suggestion replaces one nobody chose.
    const renamed = updateProject(
      db,
      u,
      p.id,
      { name: "Running", icon: "🏃", iconChosen: false },
      "web",
    );
    expect(renamed).toMatchObject({ icon: "🏃", iconChosen: false });

    // Choosing none is a choice: it clears the icon and no suggestion brings it back.
    const none = updateProject(db, u, p.id, { icon: null }, "web");
    expect(none).toMatchObject({ icon: null, iconChosen: true });
    const later = updateProject(db, u, p.id, { name: "Runs", icon: "🏃", iconChosen: false }, "web");
    expect(later).toMatchObject({ name: "Runs", icon: null, iconChosen: true });

    // Choosing the suggestion already showing is recorded too.
    const q = createProject(db, u, { name: "Books", icon: "📚", iconChosen: false }, "web");
    expect(updateProject(db, u, q.id, { icon: "📚" }, "web").iconChosen).toBe(true);
    expect(listAudit(db, u).some((e) => e.detail === "Books: chose icon")).toBe(true);
  });

  it("rejects an invalid icon and leaves the project unchanged", () => {
    const { db } = createTestDb();
    const u = createTestUser(db);
    const p = createProject(db, u, { name: "Sidetrack" }, "web");
    expect(() =>
      updateProject(db, u, p.id, { icon: "definitely not an icon" }, "web"),
    ).toThrow(/invalid list icon/);
    expect(getProject(db, u, p.id)?.icon).toBeNull();
  });

  it("scopes projects to their owner", () => {
    const { db } = createTestDb();
    const alice = createTestUser(db, { email: "alice@test.local" });
    const bob = createTestUser(db, { email: "bob@test.local" });
    createProject(db, alice, { name: "Alice project" }, "web");
    createProject(db, bob, { name: "Bob project" }, "web");

    expect(listProjects(db, alice).map((p) => p.name)).toEqual([
      "Alice project",
    ]);
    expect(listProjects(db, bob).map((p) => p.name)).toEqual(["Bob project"]);
  });
});
