import { beforeEach, describe, expect, it, vi } from "vitest";
import { addItem } from "@/core/items";
import { acceptInvite, inviteMember } from "@/core/members";
import { createProject } from "@/core/projects";
import { createTestDb, createTestUser } from "@/core/test-helpers";
import { checkDraftItem } from "@/lib/itemSuggest";
import { suggestForNewItemAction } from "./actions";

// The actions run against a real in-memory DB as `viewer`; only the
// framework seams (session, cache, env) and the Jev request are stubbed.
const ctx = vi.hoisted(() => ({ db: null as unknown, viewer: "" }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/auth/session", () => ({
  requireUserId: async () => ctx.viewer,
  getCurrentSession: async () => null,
}));
vi.mock("@/core/db", () => ({ getDb: () => ({ db: ctx.db }) }));
vi.mock("@/lib/env", () => ({ getEnv: () => ({ TYPESAFE_API_KEY: "test" }) }));
vi.mock("@/lib/itemSuggest", () => ({
  checkDraftItem: vi.fn(),
  suggestList: vi.fn(),
}));

type Db = ReturnType<typeof createTestDb>["db"];
let db: Db;

beforeEach(() => {
  db = createTestDb().db;
  ctx.db = db;
});

describe("suggestForNewItemAction", () => {
  it("names a shared list's item by its qualified ref when its prefix clashes", async () => {
    const fred = createTestUser(db, { username: "fred" });
    const bob = createTestUser(db, { username: "bob" });
    const shared = createProject(db, fred, { name: "Engineering" }, "web");
    inviteMember(db, fred, shared.id, "bob", "web");
    acceptInvite(db, bob, shared.id, "web");
    // Bob's own ENG list makes the shared one fred/ENG on his board.
    createProject(db, bob, { name: "Engines" }, "web");
    const target = addItem(db, fred, { projectId: shared.id, title: "Fix login" }, "web");
    vi.mocked(checkDraftItem).mockResolvedValue({ duplicateId: target.id, parentId: null });

    ctx.viewer = bob;
    const result = await suggestForNewItemAction({
      projectId: shared.id,
      title: "Fix the login",
      description: "",
    });
    expect(result.duplicate?.ref).toBe(`fred/ENG-${target.number}`);
  });
});
