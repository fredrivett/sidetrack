import { beforeEach, describe, expect, it, vi } from "vitest";
import { addItem } from "@/core/items";
import { acceptInvite, inviteMember } from "@/core/members";
import { createProject } from "@/core/projects";
import { createTestDb, createTestUser } from "@/core/test-helpers";
import { checkDraftItem } from "@/lib/itemSuggest";
import { POST } from "./route";

// The reads run against a real in-memory DB as `viewer`; only the framework
// seams (session, env) and the Jev request are stubbed.
const ctx = vi.hoisted(() => ({ db: null as unknown, viewer: "" }));
vi.mock("@/auth/session", () => ({
  getCurrentSession: async () => (ctx.viewer ? { user: { id: ctx.viewer } } : null),
}));
vi.mock("@/core/db", () => ({ getDb: () => ({ db: ctx.db }) }));
vi.mock("@/lib/env", () => ({ getEnv: () => ({ TYPESAFE_API_KEY: "test" }) }));
vi.mock("@/lib/itemSuggest", () => ({
  checkDraftItem: vi.fn(async () => ({ duplicateId: null, parentId: null })),
  suggestList: vi.fn(async () => null),
}));

type Db = ReturnType<typeof createTestDb>["db"];
let db: Db;

beforeEach(() => {
  db = createTestDb().db;
  ctx.db = db;
  vi.mocked(checkDraftItem).mockClear();
});

const HOST = "sidetrack.example";

function ask(
  read: string,
  body: BodyInit,
  headers: Record<string, string> = { origin: `https://${HOST}` },
) {
  const request = new Request(`http://internal:3000/api/ai/${read}`, {
    method: "POST",
    // Behind the proxy, as deployed: the public host arrives forwarded.
    headers: { host: "internal:3000", "x-forwarded-host": HOST, ...headers },
    body,
  });
  return POST(request, { params: Promise.resolve({ read }) });
}

/** A list of fred's with one item, and fred signed in. */
function fredsList() {
  const fred = createTestUser(db, { username: "fred" });
  const list = createProject(db, fred, { name: "Engineering" }, "web");
  addItem(db, fred, { projectId: list.id, title: "Fix login" }, "web");
  ctx.viewer = fred;
  return list;
}

const draft = (projectId: string) => JSON.stringify({ projectId, title: "Fix the login", description: "" });

describe("POST /api/ai/[read]", () => {
  it("names a shared list's item by its qualified ref when its prefix clashes", async () => {
    const fred = createTestUser(db, { username: "fred" });
    const bob = createTestUser(db, { username: "bob" });
    const shared = createProject(db, fred, { name: "Engineering" }, "web");
    inviteMember(db, fred, shared.id, "bob", "web");
    acceptInvite(db, bob, shared.id, "web");
    // Bob's own ENG list makes the shared one fred/ENG on his board.
    createProject(db, bob, { name: "Engines" }, "web");
    const target = addItem(db, fred, { projectId: shared.id, title: "Fix login" }, "web");
    vi.mocked(checkDraftItem).mockResolvedValueOnce({ duplicateId: target.id, parentId: null });

    ctx.viewer = bob;
    const res = await ask("newItem", draft(shared.id));
    expect(res.status).toBe(200);
    expect((await res.json()).duplicate?.ref).toBe(`fred/ENG-${target.number}`);
  });

  it("refuses another site's page, a missing origin, and asks nothing", async () => {
    const list = fredsList();
    expect((await ask("newItem", draft(list.id), { origin: "https://evil.example" })).status).toBe(403);
    // A look-alike that only ends with the host.
    expect((await ask("newItem", draft(list.id), { origin: `https://x${HOST}` })).status).toBe(403);
    expect((await ask("newItem", draft(list.id), {})).status).toBe(403);
    expect(checkDraftItem).not.toHaveBeenCalled();
  });

  it("refuses someone signed out", async () => {
    const list = fredsList();
    ctx.viewer = "";
    expect((await ask("newItem", draft(list.id))).status).toBe(401);
    expect(checkDraftItem).not.toHaveBeenCalled();
  });

  it("answers only the reads it has, not an object's own properties", async () => {
    fredsList();
    for (const read of ["nope", "toString", "__proto__", "constructor"]) {
      expect((await ask(read, "{}")).status).toBe(404);
    }
  });

  it("refuses input that doesn't fit the read", async () => {
    const list = fredsList();
    expect((await ask("newItem", "not json")).status).toBe(400);
    expect((await ask("newItem", JSON.stringify({ projectId: list.id, title: 7 }))).status).toBe(400);
    expect(checkDraftItem).not.toHaveBeenCalled();
  });

  it("stops reading a body past its limit, whatever its length header says", async () => {
    const list = fredsList();
    const big = JSON.stringify({ projectId: list.id, title: "x".repeat(70_000), description: "" });
    expect((await ask("newItem", big)).status).toBe(413);
    expect(
      (await ask("newItem", big, { origin: `https://${HOST}`, "content-length": "10" })).status,
    ).toBe(413);
    expect(checkDraftItem).not.toHaveBeenCalled();
  });

  it("limits how often one person asks, without limiting anyone else", async () => {
    const list = fredsList();
    const codes = [];
    for (let i = 0; i < 61; i++) codes.push((await ask("newItem", draft(list.id))).status);
    expect(codes.slice(0, 60).every((c) => c === 200)).toBe(true);
    expect(codes[60]).toBe(429);

    const ann = createTestUser(db, { username: "ann" });
    const hers = createProject(db, ann, { name: "Home" }, "web");
    ctx.viewer = ann;
    expect((await ask("newItem", draft(hers.id))).status).toBe(200);
  });
});
