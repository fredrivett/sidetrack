import { describe, expect, it } from "vitest";
import { listAudit } from "./audit";
import { addItem, getItem } from "./items";
import { addLabel, listLabels, updateLabel } from "./labels";
import { createProject } from "./projects";
import { createTestDb, createTestUser } from "./test-helpers";

function seed() {
  const { db } = createTestDb();
  const userId = createTestUser(db);
  const p = createProject(db, userId, { name: "P" }, "web");
  return { db, userId, projectId: p.id };
}

describe("labels", () => {
  it("adds a label once, audited, with a chosen or suggested emoji", () => {
    const { db, userId, projectId } = seed();
    const bug = addLabel(db, userId, projectId, { name: " bug ", emoji: "🐛" }, "web");
    expect(bug).toMatchObject({ name: "bug", emoji: "🐛", emojiChosen: true });
    expect(addLabel(db, userId, projectId, { name: "bug", emoji: null }, "web").id).toBe(bug.id);
    const docs = addLabel(
      db,
      userId,
      projectId,
      { name: "docs", emoji: "📝", emojiChosen: false },
      "web",
    );
    expect(docs).toMatchObject({ emoji: "📝", emojiChosen: false });
    // No emoji given: nobody chose, so a suggestion can fill it in later.
    expect(addLabel(db, userId, projectId, { name: "misc" }, "web").emojiChosen).toBe(false);
    expect(() => addLabel(db, userId, projectId, { name: "x", emoji: "abc" }, "web")).toThrow(
      /not an emoji/,
    );
    const rows = listAudit(db, userId).filter((e) => e.entityType === "label");
    expect(rows.map((e) => e.detail).sort()).toEqual(
      ['added label "misc"', 'added label "📝 docs"', 'added label "🐛 bug"'].sort(),
    );
  });

  it("renames a label on every item that has it, and only that list's", () => {
    const { db, userId, projectId } = seed();
    const other = createProject(db, userId, { name: "Other" }, "web");
    const a = addItem(db, userId, { projectId, title: "a", labels: ["bug", "ui"] }, "web");
    const b = addItem(db, userId, { projectId, title: "b", labels: ["ui"] }, "web");
    const c = addItem(db, userId, { projectId: other.id, title: "c", labels: ["ui"] }, "web");
    const ui = listLabels(db, userId, projectId).find((l) => l.name === "ui");
    if (!ui) throw new Error("no ui label");

    updateLabel(db, userId, ui.id, { name: "frontend" }, "web");
    expect(getItem(db, userId, a.id)?.labels).toEqual(["bug", "frontend"]);
    expect(getItem(db, userId, b.id)?.labels).toEqual(["frontend"]);
    expect(getItem(db, userId, c.id)?.labels).toEqual(["ui"]);
    expect(listAudit(db, userId)[0]).toMatchObject({
      action: "update",
      entityType: "label",
      entityId: ui.id,
      detail: 'label "ui": renamed to "frontend"',
    });
    // Renaming onto another label's name would merge them; refuse instead.
    expect(() => updateLabel(db, userId, ui.id, { name: "bug" }, "web")).toThrow(/already/);
  });

  it("keeps an emoji someone chose, even none, over a suggestion", () => {
    const { db, userId, projectId } = seed();
    const l = addLabel(db, userId, projectId, { name: "gym", emoji: "🏋️", emojiChosen: false }, "web");
    const renamed = updateLabel(
      db,
      userId,
      l.id,
      { name: "running", emoji: "🏃", emojiChosen: false },
      "web",
    );
    expect(renamed).toMatchObject({ name: "running", emoji: "🏃", emojiChosen: false });

    const none = updateLabel(db, userId, l.id, { emoji: null }, "web");
    expect(none).toMatchObject({ emoji: null, emojiChosen: true });
    const later = updateLabel(db, userId, l.id, { name: "runs", emoji: "🏃", emojiChosen: false }, "web");
    expect(later).toMatchObject({ name: "runs", emoji: null, emojiChosen: true });

    // A suggestion that changes nothing writes no audit row.
    const before = listAudit(db, userId).length;
    updateLabel(db, userId, l.id, { emoji: "🏃", emojiChosen: false }, "web");
    expect(listAudit(db, userId)).toHaveLength(before);
  });
});
