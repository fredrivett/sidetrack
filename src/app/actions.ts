"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  createApiKey as createApiKeyCore,
  revokeApiKey as revokeApiKeyCore,
} from "@/core/api-keys";
import { listAudit as listAuditCore } from "@/core/audit";
import {
  addGithubWebhookSecret as addGithubWebhookSecretCore,
  removeGithubWebhook as removeGithubWebhookCore,
  removeGithubWebhookSecret as removeGithubWebhookSecretCore,
} from "@/core/github";
import {
  addCategory as addCategoryCore,
  listCategories as listCategoriesCore,
} from "@/core/categories";
import { getDb } from "@/core/db";
import {
  addItem as addItemCore,
  completeItem as completeItemCore,
  deleteItem as deleteItemCore,
  type ItemSort,
  listDoneBefore as listDoneBeforeCore,
  reorderItem as reorderItemCore,
  setItemOrder as setItemOrderCore,
  setItemParent as setItemParentCore,
  setItemsCollapsed as setItemsCollapsedCore,
  sortItems as sortItemsCore,
  uncompleteItem as uncompleteItemCore,
  updateItem as updateItemCore,
} from "@/core/items";
import { projectRefPrefixes as projectRefPrefixesCore } from "@/core/itemRef";
import {
  acceptInvite as acceptInviteCore,
  declineInvite as declineInviteCore,
  inviteMember as inviteMemberCore,
  listMembers as listMembersCore,
  listSuggestedCollaborators as listSuggestedCollaboratorsCore,
  removeMember as removeMemberCore,
} from "@/core/members";
import {
  createProject as createProjectCore,
  deleteProject as deleteProjectCore,
  getProject as getProjectCore,
  getProjectWithItems as getProjectWithItemsCore,
  listProjects as listProjectsCore,
  sampleOpenItemTitles as sampleOpenItemTitlesCore,
  reorderProject as reorderProjectCore,
  updateProject as updateProjectCore,
} from "@/core/projects";
import type { AuditSource, ProjectStatus } from "@/core/schema";
import {
  AVATAR_MAX_BYTES,
  setTimeZone as setTimeZoneCore,
  setAvatarUrl as setAvatarUrlCore,
  setUploadedAvatar as setUploadedAvatarCore,
  setUsername as setUsernameCore,
} from "@/core/users";
import { getCurrentSession, requireUserId } from "@/auth/session";
import { notifyInvite } from "@/lib/email";
import { suggestEmoji } from "@/lib/emojiSuggest";
import { getEnv } from "@/lib/env";
import { checkDraftItem, suggestList } from "@/lib/itemSuggest";
import { formatItemRef } from "@/lib/itemRef";
import type { Repeat } from "@/lib/repeat";

const SOURCE: AuditSource = "web";

function refresh() {
  revalidatePath("/");
}

export async function createProjectAction(input: {
  name: string;
  summary?: string;
  homepageUrl?: string | null;
  icon?: string | null;
}) {
  const userId = await requireUserId();
  const { db } = getDb();
  // Pick the fields, so a crafted call can't pass others (e.g. status).
  const { name, summary, homepageUrl, icon } = input;
  const p = createProjectCore(
    db,
    userId,
    { name, summary, homepageUrl, icon },
    SOURCE,
  );
  refresh();
  return p;
}

export async function updateProjectAction(
  id: string,
  patch: {
    name?: string;
    status?: ProjectStatus;
    summary?: string;
    prefix?: string;
    homepageUrl?: string | null;
    icon?: string | null;
  },
) {
  const userId = await requireUserId();
  const { db } = getDb();
  const p = updateProjectCore(db, userId, id, patch, SOURCE);
  refresh();
  return p;
}

// Read-only: suggestions are only applied when the user picks one, through
// updateProjectAction, so nothing is audited here. [] when AI is off.
export async function suggestProjectIconsAction(id: string) {
  const userId = await requireUserId();
  const apiKey = getEnv().TYPESAFE_API_KEY;
  if (!apiKey) return [];
  const { db } = getDb();
  const found = getProjectWithItemsCore(db, userId, id);
  if (!found) return [];
  return suggestEmoji(
    {
      name: found.project.name,
      summary: found.project.summary,
      itemTitles: found.items.slice(0, 20).map((it) => it.title),
      homepageUrl: found.project.homepageUrl,
    },
    apiKey,
  );
}

// The same for a list still being written in the New list dialog, from what's
// typed so far. Read-only; [] when AI is off.
export async function suggestNewListIconsAction(input: {
  name: string;
  summary: string;
  homepageUrl: string | null;
}) {
  await requireUserId();
  const apiKey = getEnv().TYPESAFE_API_KEY;
  if (!apiKey || !input.name.trim()) return [];
  return suggestEmoji({ ...input, itemTitles: [] }, apiKey);
}

// Read-only suggestions for an item being written in the New item dialog:
// the list it fits (when none was chosen), and an open item in that list it
// repeats or is a step of. Nothing is applied here; the dialog shows them.
export async function suggestForNewItemAction(input: {
  projectId: string | null;
  title: string;
  description: string;
}) {
  const userId = await requireUserId();
  const apiKey = getEnv().TYPESAFE_API_KEY;
  const draft = { title: input.title.trim(), description: input.description.trim() };
  const nothing = { projectId: null, duplicate: null, parent: null };
  if (!apiKey || !draft.title) return nothing;
  const { db } = getDb();
  let projectId = input.projectId;
  if (!projectId) {
    const titles = sampleOpenItemTitlesCore(db, userId, 10);
    const lists = listProjectsCore(db, userId)
      .filter((p) => p.status === "active")
      .map((p) => ({
        id: p.id,
        name: p.name,
        summary: p.summary,
        itemTitles: titles.get(p.id) ?? [],
      }));
    projectId = await suggestList(draft, lists, apiKey);
    if (!projectId) return nothing;
  }
  const found = getProjectWithItemsCore(db, userId, projectId);
  if (!found) return nothing;
  const { duplicateId, parentId } = await checkDraftItem(
    draft,
    found.items.map((it) => ({
      id: it.id,
      title: it.title,
      topLevel: !it.parentId,
    })),
    apiKey,
  );
  // The ref as the board shows it: owner-qualified when the prefix clashes.
  const prefix = projectRefPrefixesCore(db, userId)[projectId] ?? found.project.prefix;
  const hint = (id: string | null) => {
    const it = found.items.find((i) => i.id === id);
    return it
      ? {
          id: it.id,
          ref: formatItemRef(prefix, it.number),
          title: it.title,
        }
      : null;
  };
  return { projectId, duplicate: hint(duplicateId), parent: hint(parentId) };
}

export async function reorderProjectAction(id: string, ref: string) {
  const userId = await requireUserId();
  const { db } = getDb();
  const p = reorderProjectCore(db, userId, id, ref, SOURCE);
  refresh();
  return p;
}

export async function deleteProjectAction(id: string) {
  const userId = await requireUserId();
  const { db } = getDb();
  deleteProjectCore(db, userId, id, SOURCE);
  refresh();
}

export async function listMembersAction(projectId: string) {
  const userId = await requireUserId();
  const { db } = getDb();
  return listMembersCore(db, userId, projectId);
}

export async function listSuggestedCollaboratorsAction(projectId: string) {
  const userId = await requireUserId();
  const { db } = getDb();
  return listSuggestedCollaboratorsCore(db, userId, projectId);
}

/** Absolute base URL for links in outgoing email: the configured
 * BETTER_AUTH_URL, else derived from the incoming request's headers. */
async function appBaseUrl(): Promise<string> {
  const configured = getEnv().BETTER_AUTH_URL;
  if (configured) return configured.replace(/\/$/, "");
  const h = await headers();
  const host = h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  return host ? `${proto}://${host}` : "";
}

export async function inviteMemberAction(projectId: string, person: string) {
  const session = await getCurrentSession();
  if (!session) redirect("/login");
  const userId = session.user.id;
  const { db } = getDb();
  const member = inviteMemberCore(db, userId, projectId, person, SOURCE);

  // Notify the invitee by email (best-effort; the in-app banner is the source
  // of truth, so notifyInvite never throws).
  const project = getProjectCore(db, userId, projectId);
  if (member.email && project) {
    await notifyInvite({
      to: member.email,
      inviterName: session.user.name,
      projectName: project.name,
      url: await appBaseUrl(),
    });
  }

  refresh();
  return member;
}

export async function removeMemberAction(projectId: string, targetUserId: string) {
  const userId = await requireUserId();
  const { db } = getDb();
  removeMemberCore(db, userId, projectId, targetUserId, SOURCE);
  refresh();
}

export async function acceptInviteAction(projectId: string) {
  const userId = await requireUserId();
  const { db } = getDb();
  acceptInviteCore(db, userId, projectId, SOURCE);
  refresh();
}

export async function declineInviteAction(projectId: string) {
  const userId = await requireUserId();
  const { db } = getDb();
  declineInviteCore(db, userId, projectId, SOURCE);
  refresh();
}

/** Leave a project you were invited to (remove your own membership). */
export async function leaveProjectAction(projectId: string) {
  const userId = await requireUserId();
  const { db } = getDb();
  removeMemberCore(db, userId, projectId, userId, SOURCE);
  refresh();
}

export async function addItemAction(input: {
  projectId: string;
  title: string;
  description?: string | null;
  category?: string | null;
  positionRef?: string;
  parentId?: string | null;
  dueDate?: string | null;
  dueFrom?: string | null;
  assigneeIds?: string[];
  repeat?: Repeat | null;
  subItems?: string[];
}) {
  const userId = await requireUserId();
  const { db } = getDb();
  const it = addItemCore(db, userId, input, SOURCE);
  refresh();
  return it;
}

export async function updateItemAction(
  id: string,
  patch: {
    title?: string;
    description?: string | null;
    category?: string | null;
    assigneeIds?: string[];
    addAssigneeIds?: string[];
    removeAssigneeIds?: string[];
    dueDate?: string | null;
    dueFrom?: string | null;
    repeat?: Repeat | null;
  },
) {
  const userId = await requireUserId();
  const { db } = getDb();
  const it = updateItemCore(db, userId, id, patch, SOURCE);
  refresh();
  return it;
}

export async function completeItemAction(id: string) {
  const userId = await requireUserId();
  const { db } = getDb();
  const it = completeItemCore(db, userId, id, SOURCE);
  refresh();
  return it;
}

export async function uncompleteItemAction(id: string) {
  const userId = await requireUserId();
  const { db } = getDb();
  const it = uncompleteItemCore(db, userId, id, SOURCE);
  refresh();
  return it;
}

export async function listDoneBeforeAction(opts: {
  before: number;
  limit: number;
  query?: string;
}) {
  const userId = await requireUserId();
  const { db } = getDb();
  const { before, limit, query } = opts;
  return listDoneBeforeCore(db, userId, { before, limit, query });
}

export async function reorderItemAction(id: string, ref: string) {
  const userId = await requireUserId();
  const { db } = getDb();
  const it = reorderItemCore(db, userId, id, ref, SOURCE);
  refresh();
  return it;
}

export async function setItemsCollapsedAction(ids: string[], collapsed: boolean) {
  const userId = await requireUserId();
  const { db } = getDb();
  setItemsCollapsedCore(db, userId, ids, collapsed);
  refresh();
}

export async function sortItemsAction(projectId: string, by: ItemSort) {
  const userId = await requireUserId();
  const { db } = getDb();
  const previous = sortItemsCore(db, userId, projectId, by, SOURCE);
  refresh();
  return previous;
}

export async function setItemOrderAction(projectId: string, ids: string[]) {
  const userId = await requireUserId();
  const { db } = getDb();
  setItemOrderCore(db, userId, projectId, ids, SOURCE);
  refresh();
}

export async function setItemParentAction(
  id: string,
  parentId: string | null,
  position?: string,
) {
  const userId = await requireUserId();
  const { db } = getDb();
  const it = setItemParentCore(db, userId, id, parentId, SOURCE, position);
  refresh();
  return it;
}

export async function deleteItemAction(id: string) {
  const userId = await requireUserId();
  const { db } = getDb();
  deleteItemCore(db, userId, id, SOURCE);
  refresh();
}

/** Save the browser's timezone for agents' "today". No refresh: nothing shown changes. */
export async function setTimeZoneAction(timeZone: string) {
  const userId = await requireUserId();
  const { db } = getDb();
  setTimeZoneCore(db, userId, timeZone);
}

/** Upload an avatar image (already shrunk by the browser) for the signed-in user. */
export async function uploadAvatarAction(formData: FormData) {
  const userId = await requireUserId();
  const file = formData.get("file");
  if (!(file instanceof File)) throw new Error("no avatar file");
  // Refuse an oversized file before reading it; setUploadedAvatar checks too.
  if (file.size > AVATAR_MAX_BYTES) throw new Error("avatar file is too large");
  const { db } = getDb();
  setUploadedAvatarCore(db, userId, new Uint8Array(await file.arrayBuffer()), SOURCE);
  refresh();
}

/**
 * Change the signed-in user's username, keeping the casing they typed.
 * Returns the reason it was refused ("taken", "reserved", …): production
 * builds hide a thrown Server Action's message, and these are expected.
 */
export async function setUsernameAction(
  username: string,
): Promise<{ error: string } | undefined> {
  const userId = await requireUserId();
  const { db } = getDb();
  try {
    setUsernameCore(db, userId, username, SOURCE);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Couldn't update username." };
  }
  refresh();
}

/** Set the signed-in user's avatar to an image URL, or clear it with null. */
export async function setAvatarUrlAction(url: string | null) {
  const userId = await requireUserId();
  const { db } = getDb();
  setAvatarUrlCore(db, userId, url, SOURCE);
  refresh();
}

export async function addCategoryAction(projectId: string, name: string) {
  const userId = await requireUserId();
  const { db } = getDb();
  const c = addCategoryCore(db, userId, projectId, name, SOURCE);
  refresh();
  return c;
}

export async function listCategoriesAction(projectId: string) {
  const userId = await requireUserId();
  const { db } = getDb();
  return listCategoriesCore(db, userId, projectId);
}

export async function listAuditAction(opts: {
  projectId?: string;
  itemId?: string;
  source?: AuditSource;
  limit?: number;
} = {}) {
  const userId = await requireUserId();
  const { db } = getDb();
  return listAuditCore(db, userId, opts);
}

export async function createApiKeyAction(name: string) {
  const userId = await requireUserId();
  const { db } = getDb();
  const { record, plaintext } = createApiKeyCore(db, userId, name, SOURCE);
  revalidatePath("/settings/keys");
  // plaintext is returned to the caller exactly once, then never persisted.
  return { record, plaintext };
}

export async function addGithubWebhookSecretAction(name: string) {
  const userId = await requireUserId();
  const { db } = getDb();
  const { id, secret } = addGithubWebhookSecretCore(db, userId, name, SOURCE);
  revalidatePath("/settings/github");
  // The secret is shown once, to paste into GitHub.
  return { id, secret };
}

export async function removeGithubWebhookSecretAction(id: string) {
  const userId = await requireUserId();
  const { db } = getDb();
  removeGithubWebhookSecretCore(db, userId, id, SOURCE);
  revalidatePath("/settings/github");
}

export async function removeGithubWebhookAction() {
  const userId = await requireUserId();
  const { db } = getDb();
  removeGithubWebhookCore(db, userId, SOURCE);
  revalidatePath("/settings/github");
}

export async function revokeApiKeyAction(id: string) {
  const userId = await requireUserId();
  const { db } = getDb();
  const removed = revokeApiKeyCore(db, userId, id, SOURCE);
  revalidatePath("/settings/keys");
  return { removed };
}
