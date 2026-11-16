// Rank a list's open tasks by priority with Jev. Jev reads the whole list and
// rates each task on its own ("is this one of the highest-priority tasks?"),
// so every task gets a score to sort by, not just the single top pick.
// Framework-agnostic: no DB access.

import { askJev, type NoulQuestion } from "./jev";

export interface PriorityTask {
  id: string;
  title: string;
  description: string | null;
  /** YYYY-MM-DD, or null when undated. */
  dueDate: string | null;
  /** Titles of its open sub-items, the steps left. */
  steps: string[];
}

const scoreId = (id: string) => `priority:${id}`;

/**
 * Each task's priority, from 0 to 1 (likelier to be a top priority is
 * higher), by id. Best effort: a failed request yields null, so the caller
 * can say the sort didn't happen. `fetchImpl` is injectable for tests.
 */
export async function rankByPriority(
  list: { name: string; summary: string },
  tasks: PriorityTask[],
  today: string,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Map<string, number> | null> {
  if (tasks.length === 0) return new Map();
  const describe = (t: PriorityTask) => ({
    title: t.title,
    ...(t.description && { description: t.description }),
    ...(t.dueDate && { due: t.dueDate }),
    ...(t.steps.length > 0 && { steps_left: t.steps }),
  });
  const questions: Record<string, NoulQuestion> = Object.fromEntries(
    tasks.map((t) => [
      scoreId(t.id),
      {
        type: "noul",
        instructions: {
          task: describe(t),
          question:
            "Is this task one of the highest priorities on this to-do list: the most important or urgent, to do before the others?",
        },
      },
    ]),
  );
  const answers = await askJev(
    { today, list: { name: list.name, summary: list.summary }, tasks: tasks.map(describe) },
    questions,
    apiKey,
    fetchImpl,
  );
  if (!answers) return null;
  return new Map(tasks.map((t) => [t.id, answers[scoreId(t.id)]?.true ?? 0]));
}
