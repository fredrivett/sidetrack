import { beforeEach, describe, expect, it, vi } from "vitest";
import { addItem, getItem } from "@/core/items";
import { addLabel } from "@/core/labels";
import { previewMoveItem } from "@/core/move";
import { createProject } from "@/core/projects";
import { createTestDb, createTestUser } from "@/core/test-helpers";
import { revalidatePath } from "next/cache";
import { changeSeq } from "@/core/changes";
import type { Item } from "@/core/schema";
import {
  addSubItemAction,
  completeItemAction,
  deleteItemAction,
  invitePeopleAction,
  moveItemAction,
  setItemParentAction,
  uncompleteItemAction,
  updateItemAction,
} from "./actions";

// The actions run against a real in-memory DB as `viewer`; only the
// framework seams (session, cache, env) are stubbed.
const ctx = vi.hoisted(() => ({ db: null as unknown, viewer: "" }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/auth/session", () => ({
  requireUserId: async () => ctx.viewer,
  getCurrentSession: async () => ({ user: { id: ctx.viewer, name: "Fred" } }),
}));
vi.mock("@/core/db", () => ({ getDb: () => ({ db: ctx.db }) }));
vi.mock("@/lib/env", () => ({ getEnv: () => ({ TYPESAFE_API_KEY: "test" }) }));

type Db = ReturnType<typeof createTestDb>["db"];
let db: Db;

beforeEach(() => {
  vi.mocked(revalidatePath).mockClear();
  db = createTestDb().db;
  ctx.db = db;
});

describe("moveItemAction", () => {
  it("moves nothing on a stale preview and returns the move as it is now", async () => {
    const fred = createTestUser(db, { username: "fred" });
    ctx.viewer = fred;
    const eng = createProject(db, fred, { name: "Engineering" }, "web");
    const ops = createProject(db, fred, { name: "Ops" }, "web");
    const item = addItem(db, fred, { projectId: eng.id, title: "Fix login", labels: ["Bug"] }, "web");
    const { token } = previewMoveItem(db, fred, item.id, ops.id);
    // Ops gains the label, so "Bug" would now match instead of being dropped.
    addLabel(db, fred, ops.id, { name: "Bug" }, "web");

    const stale = await moveItemAction(item.id, ops.id, token, "drop");
    expect(stale).toEqual({
      moved: false,
      plan: expect.objectContaining({
        matchedLabels: [{ from: "Bug", to: "Bug", itemIds: [item.id] }],
        missingLabels: [],
      }),
    });
    expect(getItem(db, fred, item.id)?.projectId).toBe(eng.id);

    if (stale.moved) throw new Error("unreachable");
    const done = await moveItemAction(item.id, ops.id, stale.plan.token);
    expect(done.moved).toBe(true);
    expect(getItem(db, fred, item.id)).toMatchObject({ projectId: ops.id, labels: ["Bug"] });
  });
});

describe("invitePeopleAction", () => {
  // Production hides a thrown Server Action's message (React error #441),
  // so a refusal the person can act on comes back instead.
  it("returns why it refused, such as someone without an account", async () => {
    const fred = createTestUser(db, { username: "fred" });
    ctx.viewer = fred;
    const home = createProject(db, fred, { name: "Home" }, "web");

    const refused = await invitePeopleAction(["jo@example.com"], [{ kind: "list", id: home.id, role: "commenter" }]);
    expect(refused).toEqual({ error: "jo@example.com isn't on Sidetrack yet", notOnSidetrack: ["jo@example.com"] });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

// Item saves hand back every row they changed, instead of reloading the board.
describe("item saves", () => {
  function checklist() {
    const fred = createTestUser(db, { username: "fred" });
    ctx.viewer = fred;
    const projectId = createProject(db, fred, { name: "Home" }, "web").id;
    const parent = addItem(db, fred, { projectId, title: "Trip" }, "web");
    const lines = ["Pack", "Tickets"].map((title) =>
      addItem(db, fred, { projectId, title, parentId: parent.id }, "web"),
    );
    return { fred, projectId, parent, lines };
  }
  const row = (saved: { items: Item[] }, id: string) => saved.items.find((i) => i.id === id);

  it("ticking the last open line returns its parent, done, without reloading", async () => {
    const { parent, lines } = checklist();
    await completeItemAction(lines[0].id);
    const before = changeSeq();
    const saved = await completeItemAction(lines[1].id);
    expect(row(saved, parent.id)?.completedAt).not.toBeNull();
    expect(row(saved, lines[1].id)?.completedAt).not.toBeNull();
    expect(saved).toMatchObject({ from: before, seq: changeSeq() });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("reopening a line returns its parent, reopened", async () => {
    const { parent, lines } = checklist();
    await completeItemAction(parent.id);
    const saved = await uncompleteItemAction(lines[0].id);
    expect(row(saved, parent.id)?.completedAt).toBeNull();
  });

  it("deleting a parent says its lines are gone too", async () => {
    const { parent, lines } = checklist();
    const saved = await deleteItemAction(parent.id);
    expect(new Set(saved.gone)).toEqual(new Set([parent.id, ...lines.map((l) => l.id)]));
    expect(saved.items).toEqual([]);
  });

  it("nesting returns the checklist it leaves and the one it joins", async () => {
    const { fred, projectId, parent, lines } = checklist();
    const other = addItem(db, fred, { projectId, title: "Party" }, "web");
    const saved = await setItemParentAction(lines[0].id, other.id);
    expect(row(saved, lines[0].id)?.parentId).toBe(other.id);
    expect(new Set(saved.items.map((i) => i.id))).toEqual(
      new Set([parent.id, lines[1].id, other.id, lines[0].id]),
    );
  });

  it("adding a line to a finished parent returns it reopened, and says the adder follows the line", async () => {
    const { parent } = checklist();
    await completeItemAction(parent.id);
    const saved = await addSubItemAction(parent.id, "Passport");
    const line = saved.items.find((i) => i.title === "Passport");
    expect(row(saved, parent.id)?.completedAt).toBeNull();
    expect(saved.followed).toContain(line?.id);
  });

  it("still reloads for a label change, which can make new labels", async () => {
    const { parent } = checklist();
    expect(await updateItemAction(parent.id, { labels: ["Holiday"] })).toBeUndefined();
    expect(revalidatePath).toHaveBeenCalled();
  });
});
