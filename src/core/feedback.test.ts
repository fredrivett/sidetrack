import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { addFeedbackFollowUp, FOLLOW_UP_MS, feedbackFollowUps, submitFeedback } from "./feedback";
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

  it("files a thumbs up or down on the greeting, tagged with its area, with what it said", () => {
    const { db } = createTestDb();
    const owner = createTestUser(db);
    const jane = createTestUser(db, { username: "jane" });
    const list = createProject(db, owner, { name: "Feedback" }, "web");
    const greeting = "Good morning, Jane.\n\nCall the bank slipped past Monday.";

    const up = submitFeedback(
      db,
      jane,
      { listId: list.id, kind: "other", message: "", about: { area: "greeting", rating: "up", context: greeting } },
      "web",
    );
    const item = getItem(db, owner, up.itemId);
    expect(item?.title).toBe("👍 Agenda greeting");
    expect(item?.labels).toEqual(["Other", "Feedback", "Agenda greeting"]);
    expect(item?.description).toBe(
      "> Good morning, Jane. Call the bank slipped past Monday.\n\n---\nFrom @jane",
    );

    const down = submitFeedback(
      db,
      jane,
      {
        listId: list.id,
        kind: "other",
        message: "It named a list I'd left",
        about: { area: "greeting", rating: "down", context: "x".repeat(5000) },
      },
      "web",
    );
    const said = getItem(db, owner, down.itemId);
    expect(said?.title).toBe("👎 Agenda greeting: It named a list I'd left");
    expect(said?.description?.split("\n\n")[1]).toBe(`> ${"x".repeat(1000)}`);

    // Only areas and ratings the app knows.
    const bad = (about: object) => () =>
      submitFeedback(db, jane, { listId: list.id, kind: "other", message: "hi", about: about as never }, "web");
    expect(bad({ area: "Anything I like", rating: "up", context: "" })).toThrow(/area/);
    expect(bad({ area: "toString", rating: "up", context: "" })).toThrow(/area/);
    expect(bad({ area: "greeting", rating: "meh", context: "" })).toThrow(/rating/);
    expect(bad({ area: "greeting", rating: "up", context: { x: 1 } })).toThrow(/rating/);
    // And a message still needed without one.
    expect(() => submitFeedback(db, jane, { listId: list.id, kind: "bug", message: " " }, "web")).toThrow(/empty/);
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

describe("feedback follow-ups", () => {
  function setup() {
    const { db } = createTestDb();
    const owner = createTestUser(db);
    const jane = createTestUser(db, { username: "jane" });
    const list = createProject(db, owner, { name: "Feedback" }, "web");
    const { itemId } = submitFeedback(
      db,
      jane,
      { listId: list.id, kind: "bug", message: "drag and drop is broken", page: "/" },
      "web",
    );
    return { db, owner, jane, list, itemId };
  }

  it("asks Claude about what was filed, without who sent it, once per item", async () => {
    const { db, jane, list, itemId } = setup();
    const bodies: string[] = [];
    const impl = (async (_: string, init: RequestInit) => {
      bodies.push(String(init.body));
      const questions = [
        { question: "What were you dragging?", answers: ["An item", "A list", "An item"] },
        { question: "Where?", answers: ["Only one"] },
        { question: "See https://evil.example", answers: ["Yes", "No"] },
      ];
      return new Response(
        JSON.stringify({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({ missing: "what they dragged", questions }) }] }),
      );
    }) as unknown as typeof fetch;

    const asked = await feedbackFollowUps(db, jane, { listId: list.id, itemId }, "k", impl);
    // Repeated answers merge; a question with one answer, or a link, is dropped.
    expect(asked).toEqual([{ question: "What were you dragging?", answers: ["An item", "A list"] }]);
    expect(bodies[0]).toContain("drag and drop is broken");
    expect(bodies[0]).not.toContain("@jane");
    expect(await feedbackFollowUps(db, jane, { listId: list.id, itemId }, "k", impl)).toEqual([]);
    expect(bodies).toHaveLength(1);
  });

  it("asks nothing for someone else's feedback, or without a key", async () => {
    const { db, owner, list, itemId } = setup();
    const impl = (async () => {
      throw new Error("should not be called");
    }) as unknown as typeof fetch;
    expect(await feedbackFollowUps(db, owner, { listId: list.id, itemId }, "k", impl)).toEqual([]);
    expect(await feedbackFollowUps(db, owner, { listId: list.id, itemId }, undefined, impl)).toEqual([]);
  });

  it("adds the sender's answers above the footer, once, audited as theirs", () => {
    const { db, owner, jane, list, itemId } = setup();
    addFeedbackFollowUp(
      db,
      jane,
      {
        listId: list.id,
        itemId,
        answers: [
          { question: "What were you dragging?", answer: "A sub-item" },
          { question: "What happened?", answer: "  " },
        ],
        note: "On iPad",
      },
      "web",
    );
    expect(getItem(db, owner, itemId)?.description).toBe(
      "drag and drop is broken\n\n**Follow-up**\n\n- What were you dragging? — A sub-item\n\nOn iPad" +
        "\n\n---\nFrom @jane · on `/`",
    );
    const audit = db.select().from(auditLog).where(eq(auditLog.entityId, itemId)).all();
    expect(audit.map((a) => [a.actor, a.action])).toEqual([
      [jane, "create"],
      [jane, "update"],
    ]);
    // Once only, so it can't be used to keep rewriting the item.
    expect(() =>
      addFeedbackFollowUp(db, jane, { listId: list.id, itemId, answers: [], note: "More" }, "web"),
    ).toThrow(/already/);
  });

  it("refuses anyone else, an empty follow-up, and a late one", () => {
    const { db, owner, jane, list, itemId } = setup();
    const add = (userId: string, note: string, now?: number) => () =>
      addFeedbackFollowUp(db, userId, { listId: list.id, itemId, answers: [], note }, "web", now);
    expect(add(owner, "Hi")).toThrow(/can't be added/);
    expect(add(jane, " ")).toThrow(/empty/);
    const createdAt = getItem(db, owner, itemId)?.createdAt ?? 0;
    expect(add(jane, "Late", createdAt + FOLLOW_UP_MS + 1000)).toThrow(/can't be added/);
    expect(add(jane, "Just in time", createdAt + FOLLOW_UP_MS - 1000)).not.toThrow();
  });
});
