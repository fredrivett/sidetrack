import { describe, expect, it } from "vitest";
import { listAudit } from "./audit";
import { addItem, getItem, listItems } from "./items";
import { createProject } from "./projects";
import {
  addFromSource,
  getItemSource,
  getSource,
  listPendingSources,
  proposeFromPhoto,
  receiveSourcePhoto,
} from "./sources";
import { createTestDb, createTestUser } from "./test-helpers";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const mcp = { source: "mcp" as const, agent: { keyId: "k1", name: "Fred's Claude" } };

function setup() {
  const { db } = createTestDb();
  const fred = createTestUser(db, { username: "fred" });
  const home = createProject(db, fred, { name: "Home" }, "web");
  return { db, fred, home };
}

describe("adding a photo's lines", () => {
  it("adds the reviewed lines: a checklist under its line, ticks a match, skips the rest", () => {
    const { db, fred, home } = setup();
    const plan = addItem(db, fred, { projectId: home.id, title: "Change phone plan" }, "web");
    const fredLine = addItem(db, fred, { projectId: home.id, title: "Fred", parentId: plan.id }, "web");

    const { sourceId, uploadToken } = proposeFromPhoto(
      db,
      fred,
      {
        lines: [
          { title: "Tidy up flat", projectId: home.id, region: { x: 0.1, y: 0.1, w: 0.2, h: 0.05 } },
          { title: "Lounge", projectId: home.id, parent: 0, done: true },
          { title: "Bedroom", projectId: home.id, parent: 0 },
          { title: "Fred", projectId: home.id, matchItemId: fredLine.id, done: true },
          { title: "Doodle", projectId: home.id },
          { title: "Slippers", projectId: home.id },
        ],
      },
      "Fred's Claude",
    );
    expect(() => addFromSource(db, fred, sourceId, [], mcp)).toThrow(/hasn't been uploaded/);
    expect(receiveSourcePhoto(db, uploadToken, JPEG)).toEqual({ ok: true, sourceId });
    expect(listPendingSources(db, fred).map((s) => s.id)).toEqual([sourceId]);

    const lines = getSource(db, fred, sourceId)?.lines ?? [];
    const result = addFromSource(
      db,
      fred,
      sourceId,
      lines.map((l) => ({
        id: l.id,
        add: l.title !== "Doodle",
        ...(l.title === "Slippers" ? { title: "Buy slippers" } : {}),
      })),
      mcp,
    );
    expect(result).toEqual({ added: 4, updated: 0, completed: 1, skipped: 1 });

    const items = listItems(db, fred, home.id, { includeCompleted: true });
    const tidy = items.find((i) => i.title === "Tidy up flat");
    if (!tidy) throw new Error("Tidy up flat wasn't added");
    const sub = items.filter((i) => i.parentId === tidy.id);
    expect(sub.map((i) => [i.title, i.completedAt !== null])).toEqual([
      ["Lounge", true],
      ["Bedroom", false],
    ]);
    expect(items.some((i) => i.title === "Buy slippers" && i.parentId === null)).toBe(true);
    expect(items.some((i) => i.title === "Doodle")).toBe(false);
    expect(getItem(db, fred, fredLine.id)?.completedAt).not.toBeNull();
    // Only the existing two plus the four added.
    expect(items).toHaveLength(6);

    expect(getItemSource(db, fred, tidy.id)).toMatchObject({
      sourceId,
      region: { x: 0.1, y: 0.1, w: 0.2, h: 0.05 },
    });
    expect(getItemSource(db, fred, fredLine.id)?.sourceId).toBe(sourceId);

    const audit = listAudit(db, fred, {});
    const describe = (id: string, action: string) =>
      audit.find((e) => e.entityId === id && e.action === action);
    expect(describe(tidy.id, "create")).toMatchObject({ source: "mcp", agentName: "Fred's Claude" });
    expect(describe(tidy.id, "create")?.detail).toMatch(/from a photo$/);
    expect(describe(fredLine.id, "complete")?.detail).toMatch(/from a photo$/);
    expect(describe(sourceId, "create")?.detail).toBe(
      "added 4 items and ticked off 1 from a photo of a page",
    );

    expect(listPendingSources(db, fred)).toEqual([]);
    expect(() => addFromSource(db, fred, sourceId, [], mcp)).toThrow(/already been added/);
  });

  it("changes a matched item only where the page or the review differs from it", () => {
    const { db, fred, home } = setup();
    const lorna = createTestUser(db, { username: "lorna" });
    const water = addItem(
      db,
      fred,
      { projectId: home.id, title: "Water plants", dueDate: "2026-11-25", labels: ["garden"] },
      "web",
    );
    const salt = addItem(db, fred, { projectId: home.id, title: "Refill salt", dueDate: "2026-11-30" }, "web");
    const { sourceId, uploadToken } = proposeFromPhoto(
      db,
      fred,
      {
        lines: [
          // Circled on the page: the agent brings it forward and labels it.
          { title: "Water plants", projectId: home.id, matchItemId: water.id, dueDate: "2026-11-21", labels: ["next"] },
          // Untouched on the page and in review.
          { title: "Refill salt", projectId: home.id, matchItemId: salt.id },
        ],
      },
      null,
    );
    receiveSourcePhoto(db, uploadToken, JPEG);
    const [waterLine, saltLine] = getSource(db, fred, sourceId)?.lines ?? [];
    expect(() =>
      addFromSource(db, fred, sourceId, [{ id: waterLine.id, add: true, assigneeIds: [lorna] }], "web"),
    ).toThrow();
    const result = addFromSource(
      db,
      fred,
      sourceId,
      [
        { id: waterLine.id, add: true, repeat: { every: 1, unit: "week" } },
        { id: saltLine.id, add: true },
      ],
      "web",
    );
    expect(result).toEqual({ added: 0, updated: 1, completed: 0, skipped: 0 });
    expect(getItem(db, fred, water.id)).toMatchObject({
      dueDate: "2026-11-21",
      labels: ["garden", "next"],
      repeatEvery: 1,
      repeatUnit: "week",
      completedAt: null,
    });
    expect(getItem(db, fred, salt.id)).toMatchObject({ dueDate: "2026-11-30", repeatEvery: null });
    const updates = listAudit(db, fred, {}).filter((e) => e.action === "update");
    expect(updates.map((e) => e.entityId)).toEqual([water.id]);
    expect(updates[0].detail).toMatch(/from a photo$/);
  });

  it("adds a sub-item to the list its parent line was moved to", () => {
    const { db, fred, home } = setup();
    const shopping = createProject(db, fred, { name: "Shopping" }, "web");
    const { sourceId, uploadToken } = proposeFromPhoto(
      db,
      fred,
      { lines: [{ title: "Coffee", projectId: home.id }, { title: "Beans", projectId: home.id, parent: 0 }] },
      null,
    );
    receiveSourcePhoto(db, uploadToken, JPEG);
    const [coffee, beans] = getSource(db, fred, sourceId)?.lines ?? [];
    addFromSource(
      db,
      fred,
      sourceId,
      [{ id: coffee.id, add: true, projectId: shopping.id }, { id: beans.id, add: true }],
      "web",
    );
    expect(listItems(db, fred, shopping.id).map((i) => i.title).sort()).toEqual(["Beans", "Coffee"]);
    expect(listItems(db, fred, home.id)).toEqual([]);
  });

  it("adds a sub-item on its own when its parent line is skipped", () => {
    const { db, fred, home } = setup();
    const { sourceId, uploadToken } = proposeFromPhoto(
      db,
      fred,
      { lines: [{ title: "Buy", projectId: home.id }, { title: "Slippers", projectId: home.id, parent: 0 }] },
      null,
    );
    receiveSourcePhoto(db, uploadToken, JPEG);
    const [buy, slippers] = getSource(db, fred, sourceId)?.lines ?? [];
    addFromSource(db, fred, sourceId, [{ id: buy.id, add: false }, { id: slippers.id, add: true }], "web");
    const items = listItems(db, fred, home.id);
    expect(items.map((i) => [i.title, i.parentId])).toEqual([["Slippers", null]]);
  });

  it("refuses lines that name a list or item the user can't change, adding nothing", () => {
    const { db, fred, home } = setup();
    const lorna = createTestUser(db, { username: "lorna" });
    const hers = createProject(db, lorna, { name: "Lorna's" }, "web");
    const propose = (lines: Parameters<typeof proposeFromPhoto>[2]["lines"]) => () =>
      proposeFromPhoto(db, fred, { lines }, null);
    expect(propose([{ title: "x", projectId: hers.id }])).toThrow(/line 0: list not found/);
    expect(propose([{ title: "a", projectId: home.id }, { title: "b", projectId: home.id, parent: 1 }])).toThrow(
      /line 1: parent must be the index of an earlier line/,
    );
    expect(propose([{ title: "a", projectId: home.id, region: { x: 0.9, y: 0, w: 0.5, h: 0.1 } }])).toThrow(
      /line 0: region/,
    );
    expect(
      propose([{ title: "a", projectId: home.id, region: { x: 0.1, y: 0, w: 0.5, h: 0.1, angle: 400 } }]),
    ).toThrow(/line 0: region angle/);
    expect(propose([{ title: "a", projectId: home.id, assigneeIds: [lorna] }])).toThrow(
      /line 0: can't assign/,
    );
    expect(
      propose([{ title: "a", projectId: home.id, repeat: { every: 0, unit: "day" } }]),
    ).toThrow(/line 0: invalid repeat/);
    expect(listPendingSources(db, fred)).toEqual([]);
    expect(getSource(db, lorna, "nope")).toBeNull();
  });

  it("takes the photo once, within the hour, and only as an image", () => {
    const { db, fred, home } = setup();
    const propose = () =>
      proposeFromPhoto(db, fred, { lines: [{ title: "a", projectId: home.id }] }, null);
    const late = propose();
    expect(receiveSourcePhoto(db, late.uploadToken, JPEG, late.expiresAt + 1)).toMatchObject({
      status: 410,
    });
    const { uploadToken, sourceId } = propose();
    expect(receiveSourcePhoto(db, uploadToken, new TextEncoder().encode("<html>"))).toMatchObject({
      status: 415,
    });
    expect(receiveSourcePhoto(db, uploadToken, JPEG)).toMatchObject({ ok: true });
    expect(receiveSourcePhoto(db, uploadToken, JPEG)).toMatchObject({ status: 404 });
    expect(getSource(db, fred, sourceId)?.hasPhoto).toBe(true);
  });
});
