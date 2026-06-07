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
import { createTestDb } from "./test-helpers";

function seedItem() {
  const { db } = createTestDb();
  const p = createProject(db, { name: "P" }, "web");
  const item = addItem(db, { projectId: p.id, kind: "task", title: "t" }, "web");
  return { db, projectId: p.id, itemId: item.id };
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
    const { db, projectId, itemId } = seedItem();
    const link = linkItemToPr(db, itemId, PR, "mcp");
    expect(link.itemId).toBe(itemId);
    expect(link.prUrl).toBe(PR);
    expect(link.linkedBySource).toBe("mcp");

    const last = listAudit(db, { projectId }).find(
      (e) => e.action === "link" && e.entityId === itemId,
    );
    expect(last?.source).toBe("mcp");
    expect(last?.projectId).toBe(projectId);
  });

  it("canonicalizes the url before persisting", () => {
    const { db, itemId } = seedItem();
    const link = linkItemToPr(db, itemId, `${PR}/files#diff`, "web");
    expect(link.prUrl).toBe(PR);
  });

  it("is idempotent: relinking the same pair writes no second audit row", () => {
    const { db, itemId } = seedItem();
    linkItemToPr(db, itemId, PR, "web");
    const before = listAudit(db).length;
    const again = linkItemToPr(db, itemId, `${PR}?x=1`, "web");
    expect(again.prUrl).toBe(PR);
    expect(listAudit(db).length).toBe(before);
    expect(listPrLinksForItem(db, itemId)).toHaveLength(1);
  });

  it("supports many-to-many links", () => {
    const { db, projectId } = seedItem();
    const a = addItem(db, { projectId, kind: "task", title: "a" }, "web");
    const b = addItem(db, { projectId, kind: "task", title: "b" }, "web");
    linkItemToPr(db, a.id, PR, "web");
    linkItemToPr(db, b.id, PR, "web");
    linkItemToPr(db, a.id, "https://github.com/owner/repo/pull/43", "web");

    expect(listItemsForPr(db, PR).map((l) => l.itemId).sort()).toEqual(
      [a.id, b.id].sort(),
    );
    expect(listPrLinksForItem(db, a.id)).toHaveLength(2);
  });

  it("unlinks and logs it", () => {
    const { db, itemId } = seedItem();
    linkItemToPr(db, itemId, PR, "web");
    unlinkItemFromPr(db, itemId, `${PR}/files`, "github");
    expect(listPrLinksForItem(db, itemId)).toEqual([]);
    const last = listAudit(db).find((e) => e.entityId === itemId);
    expect(last?.action).toBe("unlink");
    expect(last?.source).toBe("github");
  });

  it("unlinking a missing link is a no-op with no audit row", () => {
    const { db, itemId } = seedItem();
    const before = listAudit(db).length;
    unlinkItemFromPr(db, itemId, PR, "web");
    expect(listAudit(db).length).toBe(before);
  });

  it("throws when linking a non-existent item", () => {
    const { db } = seedItem();
    expect(() => linkItemToPr(db, "nope", PR, "web")).toThrow();
  });

  it("cascades: deleting the item removes its PR links", () => {
    const { db, itemId } = seedItem();
    linkItemToPr(db, itemId, PR, "web");
    deleteItem(db, itemId, "web");
    expect(listItemsForPr(db, PR)).toEqual([]);
  });
});
