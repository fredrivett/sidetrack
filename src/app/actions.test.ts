import { beforeEach, describe, expect, it, vi } from "vitest";
import { addItem, getItem } from "@/core/items";
import { addLabel } from "@/core/labels";
import { previewMoveItem } from "@/core/move";
import { createProject } from "@/core/projects";
import { createTestDb, createTestUser } from "@/core/test-helpers";
import { moveItemAction } from "./actions";

// The actions run against a real in-memory DB as `viewer`; only the
// framework seams (session, cache, env) are stubbed.
const ctx = vi.hoisted(() => ({ db: null as unknown, viewer: "" }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/auth/session", () => ({
  requireUserId: async () => ctx.viewer,
  getCurrentSession: async () => null,
}));
vi.mock("@/core/db", () => ({ getDb: () => ({ db: ctx.db }) }));
vi.mock("@/lib/env", () => ({ getEnv: () => ({ TYPESAFE_API_KEY: "test" }) }));

type Db = ReturnType<typeof createTestDb>["db"];
let db: Db;

beforeEach(() => {
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
