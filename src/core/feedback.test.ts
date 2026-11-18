import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { submitFeedback } from "./feedback";
import { getItem } from "./items";
import { listLabels } from "./labels";
import { createProject } from "./projects";
import { auditLog, items } from "./schema";
import { createTestDb, createTestUser } from "./test-helpers";

describe("submitFeedback", () => {
  it("files a non-member's feedback in the list, as them, with only safe links", () => {
    const { db } = createTestDb();
    const owner = createTestUser(db);
    const jane = createTestUser(db, { username: "jane" });
    const list = createProject(db, owner, { name: "Sidetrack feedback" }, "web");
    const release = "2f567ea5b36b244fba4924ec1d61a51f277a42c2";

    const { itemId, ref } = submitFeedback(
      db,
      jane,
      {
        listId: list.id,
        kind: "bug",
        message: "\n  Can't drag items on iPad\nThe page scrolls instead.",
        page: "/?p=abc",
        release,
        replayUrl: "https://us.posthog.com/project/phc_x/replay/s1?t=5",
        personUrl: "javascript:alert(1)",
      },
      "web",
    );

    expect(ref).toBe(`${list.prefix}-1`);
    const item = getItem(db, owner, itemId);
    expect(item?.title).toBe("Can't drag items on iPad");
    expect(item?.labels).toEqual(["Bug", "Feedback"]);
    expect(item?.description).toBe(
      "Can't drag items on iPad\nThe page scrolls instead.\n\n---\n" +
        `From @jane · on \`/?p=abc\` · build [2f567ea](https://github.com/fredrivett/sidetrack/commit/${release})\n` +
        "PostHog: [replay](https://us.posthog.com/project/phc_x/replay/s1?t=5)",
    );
    expect(listLabels(db, owner, list.id).map((l) => [l.name, l.emoji])).toEqual(
      expect.arrayContaining([["Bug", "🐛"], ["Feedback", "📣"]]),
    );
    // Jane doesn't join the list, and the history says she added it.
    expect(getItem(db, jane, itemId)).toBeUndefined();
    const audit = db.select().from(auditLog).where(eq(auditLog.entityId, itemId)).all();
    expect(audit.map((a) => [a.actor, a.action])).toEqual([[jane, "create"]]);
  });

  it("takes five an hour from one person", () => {
    const { db } = createTestDb();
    const owner = createTestUser(db);
    const jane = createTestUser(db);
    const sam = createTestUser(db);
    const list = createProject(db, owner, { name: "Feedback" }, "web");
    const send = (userId: string) =>
      submitFeedback(db, userId, { listId: list.id, kind: "idea", message: "More colours" }, "web");

    for (let i = 0; i < 5; i++) send(jane);
    expect(() => send(jane)).toThrow(/too much feedback/);
    expect(send(sam).ref).toBe(`${list.prefix}-6`);
    expect(db.select().from(items).where(eq(items.projectId, list.id)).all()).toHaveLength(6);
  });
});
