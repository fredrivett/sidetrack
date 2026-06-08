import { describe, expect, it } from "vitest";
import { listAudit } from "./audit";
import { addItem, deleteItem } from "./items";
import {
  canonicalizePrUrl,
  linkItemToPr,
  listItemsForPr,
  listPrLinksForItem,
  unlinkItemFromPr,
} from "./prLinks";
import { createProject } from "./projects";
import { createTestDb, createTestUser } from "./test-helpers";

function seedItem() {
  const { db } = createTestDb();
  const userId = createTestUser(db);
  const p = createProject(db, userId, { name: "P" }, "web");
  const item = addItem(
    db,
    userId,
    { projectId: p.id, kind: "task", title: "t" },
    "web",
  );
  return { db, userId, projectId: p.id, itemId: item.id };
}

const PR = "https://github.com/owner/repo/pull/42";

describe("canonicalizePrUrl", () => {
  it("canonicalizes a plain PR url", () => {
    expect(canonicalizePrUrl(PR)).toBe(PR);
  });

  it("strips trailing sub-path, query, and fragment", () => {
    expect(
      canonicalizePrUrl(
        "https://github.com/owner/repo/pull/42/files?w=1#diff-abc",
      ),
    ).toBe(PR);
  });

  it("drops a www. host prefix", () => {
    expect(canonicalizePrUrl("https://www.github.com/owner/repo/pull/42")).toBe(
      PR,
    );
  });

  it("lowercases owner/repo so case variants collapse to one link", () => {
    expect(canonicalizePrUrl("https://github.com/Owner/Repo/pull/42")).toBe(PR);
  });

  it("rejects non-https schemes", () => {
    expect(() => canonicalizePrUrl("javascript:alert(1)")).toThrow();
    expect(() =>
      canonicalizePrUrl("http://github.com/owner/repo/pull/42"),
    ).toThrow();
  });

  it("rejects non-github hosts", () => {
    expect(() =>
      canonicalizePrUrl("https://evil.com/owner/repo/pull/42"),
    ).toThrow();
  });

  it("rejects non-PR github paths", () => {
    expect(() =>
      canonicalizePrUrl("https://github.com/owner/repo/issues/42"),
    ).toThrow();
    expect(() => canonicalizePrUrl("https://github.com/owner/repo")).toThrow();
  });

  it("rejects empty input", () => {
    expect(() => canonicalizePrUrl("   ")).toThrow();
  });
});

describe("prLinks", () => {
  it("links an item to a PR and logs it with the caller's source", () => {
    const { db, userId, projectId, itemId } = seedItem();
    const link = linkItemToPr(db, userId, itemId, PR, "mcp");
    expect(link.itemId).toBe(itemId);
    expect(link.prUrl).toBe(PR);
    expect(link.linkedBySource).toBe("mcp");

    const last = listAudit(db, userId, { projectId }).find(
      (e) => e.action === "link" && e.entityId === itemId,
    );
    expect(last?.source).toBe("mcp");
    expect(last?.projectId).toBe(projectId);
  });

  it("canonicalizes the url before persisting", () => {
    const { db, userId, itemId } = seedItem();
    const link = linkItemToPr(db, userId, itemId, `${PR}/files#diff`, "web");
    expect(link.prUrl).toBe(PR);
  });

  it("is idempotent: relinking the same pair writes no second audit row", () => {
    const { db, userId, itemId } = seedItem();
    linkItemToPr(db, userId, itemId, PR, "web");
    const before = listAudit(db, userId).length;
    const again = linkItemToPr(db, userId, itemId, `${PR}?x=1`, "web");
    expect(again.prUrl).toBe(PR);
    expect(listAudit(db, userId).length).toBe(before);
    expect(listPrLinksForItem(db, userId, itemId)).toHaveLength(1);
  });

  it("supports many-to-many links", () => {
    const { db, userId, projectId } = seedItem();
    const a = addItem(db, userId, { projectId, kind: "task", title: "a" }, "web");
    const b = addItem(db, userId, { projectId, kind: "task", title: "b" }, "web");
    linkItemToPr(db, userId, a.id, PR, "web");
    linkItemToPr(db, userId, b.id, PR, "web");
    linkItemToPr(db, userId, a.id, "https://github.com/owner/repo/pull/43", "web");

    expect(listItemsForPr(db, userId, PR).map((l) => l.itemId).sort()).toEqual(
      [a.id, b.id].sort(),
    );
    expect(listPrLinksForItem(db, userId, a.id)).toHaveLength(2);
  });

  it("unlinks and logs it", () => {
    const { db, userId, itemId } = seedItem();
    linkItemToPr(db, userId, itemId, PR, "web");
    unlinkItemFromPr(db, userId, itemId, `${PR}/files`, "github");
    expect(listPrLinksForItem(db, userId, itemId)).toEqual([]);
    const last = listAudit(db, userId).find((e) => e.entityId === itemId);
    expect(last?.action).toBe("unlink");
    expect(last?.source).toBe("github");
  });

  it("unlinking a missing link is a no-op with no audit row", () => {
    const { db, userId, itemId } = seedItem();
    const before = listAudit(db, userId).length;
    unlinkItemFromPr(db, userId, itemId, PR, "web");
    expect(listAudit(db, userId).length).toBe(before);
  });

  it("throws when linking a non-existent item", () => {
    const { db, userId } = seedItem();
    expect(() => linkItemToPr(db, userId, "nope", PR, "web")).toThrow();
  });

  it("cascades: deleting the item removes its PR links", () => {
    const { db, userId, itemId } = seedItem();
    linkItemToPr(db, userId, itemId, PR, "web");
    deleteItem(db, userId, itemId, "web");
    expect(listItemsForPr(db, userId, PR)).toEqual([]);
  });
});
