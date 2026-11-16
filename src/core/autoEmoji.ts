// The emoji nobody chose, kept up to date on the server. An icon or label
// emoji nobody chose follows Jev's top suggestion for the text it goes with;
// the web pickers show that suggestion faded and send it with the save. These
// fill it in for saves that came without one: an agent's, or one sent before
// Jev answered. They read the DB and ask Jev, and write nothing: each returns
// the input for the core mutation to save. A no-op when AI is off.

import { autoLabelEmoji, autoListIcon } from "@/lib/emojiSuggest";
import { getEnv } from "@/lib/env";
import type { Db } from "./db";
import { getLabel, type LabelEmoji, newLabelNames } from "./labels";
import { getProject, getProjectWithItems } from "./projects";

/**
 * What Jev reads to suggest a list's icon: the list as `patch` leaves it,
 * with up to 20 of its items' titles.
 */
export function listIconContext(
  db: Db,
  userId: string,
  id: string,
  patch: { name?: string; summary?: string; homepageUrl?: string | null },
) {
  const found = getProjectWithItems(db, userId, id);
  if (!found) return null;
  return {
    project: found.project,
    context: {
      name: patch.name ?? found.project.name,
      summary: patch.summary ?? found.project.summary,
      homepageUrl:
        patch.homepageUrl === undefined ? found.project.homepageUrl : patch.homepageUrl,
      itemTitles: found.items.slice(0, 20).map((it) => it.title),
    },
  };
}

/**
 * The list patch with the icon brought up to date, when it changes what Jev
 * reads (name, summary, homepage) for a list nobody chose an icon for and
 * sets no icon itself.
 */
export async function withAutoListIcon<
  P extends { name?: string; summary?: string; homepageUrl?: string | null; icon?: string | null },
>(db: Db, userId: string, id: string, patch: P): Promise<P & { iconChosen?: boolean }> {
  const rereads =
    patch.name !== undefined || patch.summary !== undefined || patch.homepageUrl !== undefined;
  if (patch.icon !== undefined || !rereads) return patch;
  const found = listIconContext(db, userId, id, patch);
  if (!found || found.project.iconChosen) return patch;
  const icon = await autoListIcon(found.context, getEnv().TYPESAFE_API_KEY);
  return icon === undefined ? patch : { ...patch, icon, iconChosen: false };
}

/** A new list's icon when nobody chose one: Jev's for what it reads. */
export async function autoNewListIcon(input: {
  name: string;
  summary?: string;
  homepageUrl?: string | null;
}): Promise<string | null> {
  const icon = await autoListIcon(
    { name: input.name, summary: input.summary ?? "", homepageUrl: input.homepageUrl, itemTitles: [] },
    getEnv().TYPESAFE_API_KEY,
  );
  return icon ?? null;
}

/**
 * The emoji for labels an item change adds to its list: `given` (the ones
 * the client showed, by name), with Jev's for the rest.
 */
export async function withAutoLabelEmoji(
  db: Db,
  userId: string,
  projectId: string,
  names: string[] | undefined,
  given: Record<string, LabelEmoji> = {},
): Promise<Record<string, LabelEmoji>> {
  const project = getProject(db, userId, projectId);
  if (!names || !project) return given;
  const missing = newLabelNames(db, projectId, names).filter((n) => !Object.hasOwn(given, n));
  if (missing.length === 0) return given;
  const auto = await autoLabelEmoji(missing, project.name, getEnv().TYPESAFE_API_KEY);
  return {
    ...Object.fromEntries(
      Object.entries(auto).map(([name, emoji]) => [name, { emoji, chosen: false }]),
    ),
    ...given,
  };
}

/**
 * The label patch with the emoji brought up to date, when it renames a label
 * nobody chose an emoji for and sets no emoji itself.
 */
export async function withAutoLabelRename(
  db: Db,
  userId: string,
  id: string,
  patch: { name?: string; emoji?: string | null; emojiChosen?: boolean },
) {
  const name = patch.name?.trim();
  if (!name || patch.emoji !== undefined) return patch;
  const label = getLabel(db, userId, id);
  const project = label && getProject(db, userId, label.projectId);
  if (!label || !project || label.emojiChosen) return patch;
  const { [name]: emoji } = await autoLabelEmoji([name], project.name, getEnv().TYPESAFE_API_KEY);
  return emoji ? { ...patch, emoji, emojiChosen: false } : patch;
}
