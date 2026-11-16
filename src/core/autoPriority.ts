// Jev's priority for each open top-level item on a list, for sortItems to
// order by. Reads the DB and asks Jev, and writes nothing.

import { rankByPriority } from "@/lib/itemPriority";
import { getEnv } from "@/lib/env";
import { dayOf } from "@/lib/time";
import type { Db } from "./db";
import { listItems } from "./items";
import { getProject } from "./projects";
import { getTimeZone } from "./users";

/**
 * Each open top-level item's priority, 0 to 1, by id. Null when Jev couldn't
 * rank them: AI is off, or the request failed.
 */
export async function itemPriorities(
  db: Db,
  userId: string,
  projectId: string,
): Promise<Map<string, number> | null> {
  const apiKey = getEnv().TYPESAFE_API_KEY;
  if (!apiKey) return null;
  const project = getProject(db, userId, projectId);
  if (!project) throw new Error(`list not found: ${projectId}`);
  const open = listItems(db, userId, projectId);
  const steps = Map.groupBy(
    open.filter((it) => it.parentId !== null),
    (it) => it.parentId,
  );
  const tasks = open
    .filter((it) => it.parentId === null)
    .map((it) => ({
      id: it.id,
      title: it.title,
      description: it.description,
      dueDate: it.dueDate,
      dueFrom: it.dueFrom,
      steps: (steps.get(it.id) ?? []).map((s) => s.title),
    }));
  const today = dayOf(Date.now(), getTimeZone(db, userId) ?? "UTC");
  return rankByPriority(project, tasks, today, apiKey);
}
