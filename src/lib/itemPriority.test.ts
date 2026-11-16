import { describe, expect, it } from "vitest";
import { rankByPriority } from "./itemPriority";

const LIST = { name: "Japan trip", summary: "" };
const TASKS = [
  { id: "a", title: "Buy souvenirs", description: "", dueDate: null, dueFrom: null, steps: [] },
  {
    id: "b",
    title: "Renew passport",
    description: "Expires soon",
    dueDate: "2026-11-20",
    dueFrom: "2026-11-16",
    steps: ["Photos"],
  },
];

describe("rankByPriority", () => {
  it("asks about each task with the whole list as context, and scores it by Jev's yes", async () => {
    let sent: { state: { today: string; tasks: unknown[] }; questions: Record<string, unknown> } | undefined;
    const fetchImpl: typeof fetch = async (_url, init) => {
      sent = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({ answers: { "priority:a": { noul: 0.1 }, "priority:b": { noul: 0.8 } } }),
      );
    };
    const scores = await rankByPriority(LIST, TASKS, "2026-11-16", "key", fetchImpl);

    expect(scores).toEqual(new Map([["a", 0.1], ["b", 0.8]]));
    expect(Object.keys(sent?.questions ?? {})).toEqual(["priority:a", "priority:b"]);
    expect(sent?.state.today).toBe("2026-11-16");
    expect(sent?.state.tasks[1]).toEqual({
      title: "Renew passport",
      description: "Expires soon",
      due_from: "2026-11-16",
      due: "2026-11-20",
      steps_left: ["Photos"],
    });
  });

  it("returns null when the request fails or leaves a task unanswered, so nothing is sorted", async () => {
    const failing: typeof fetch = async () => new Response("", { status: 429 });
    expect(await rankByPriority(LIST, TASKS, "2026-11-16", "key", failing)).toBeNull();
    const partial: typeof fetch = async () =>
      new Response(JSON.stringify({ answers: { "priority:b": { noul: 0.8 } } }));
    expect(await rankByPriority(LIST, TASKS, "2026-11-16", "key", partial)).toBeNull();
  });
});
