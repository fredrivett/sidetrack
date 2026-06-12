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
  addCategory as addCategoryCore,
  listCategories as listCategoriesCore,
} from "@/core/categories";
import { getDb } from "@/core/db";
import {
  addItem as addItemCore,
  completeItem as completeItemCore,
  deleteItem as deleteItemCore,
  reorderItem as reorderItemCore,
  uncompleteItem as uncompleteItemCore,
  updateItem as updateItemCore,
} from "@/core/items";
import {
  acceptInvite as acceptInviteCore,
  declineInvite as declineInviteCore,
  inviteMember as inviteMemberCore,
  listMembers as listMembersCore,
  removeMember as removeMemberCore,
} from "@/core/members";
import {
  createProject as createProjectCore,
  deleteProject as deleteProjectCore,
  getProject as getProjectCore,
  reorderProject as reorderProjectCore,
  updateProject as updateProjectCore,
} from "@/core/projects";
import type { AuditSource, ItemKind, ProjectStatus } from "@/core/schema";
import { getCurrentSession, requireUserId } from "@/auth/session";
import { notifyInvite } from "@/lib/email";
import { getEnv } from "@/lib/env";

const SOURCE: AuditSource = "web";

function refresh() {
  revalidatePath("/");
}

export async function createProjectAction(name: string) {
  const userId = await requireUserId();
  const { db } = getDb();
  const p = createProjectCore(db, userId, { name }, SOURCE);
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
  kind: ItemKind;
  title: string;
  description?: string | null;
  category?: string | null;
  positionRef?: string;
}) {
  const userId = await requireUserId();
  const { db } = getDb();
  const it = addItemCore(db, userId, input, SOURCE);
  refresh();
  return it;
}

export async function updateItemAction(
  id: string,
  patch: { title?: string; description?: string | null; category?: string | null },
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

export async function reorderItemAction(id: string, ref: string) {
  const userId = await requireUserId();
  const { db } = getDb();
  const it = reorderItemCore(db, userId, id, ref, SOURCE);
  refresh();
  return it;
}

export async function deleteItemAction(id: string) {
  const userId = await requireUserId();
  const { db } = getDb();
  deleteItemCore(db, userId, id, SOURCE);
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

export async function revokeApiKeyAction(id: string) {
  const userId = await requireUserId();
  const { db } = getDb();
  const removed = revokeApiKeyCore(db, userId, id, SOURCE);
  revalidatePath("/settings/keys");
  return { removed };
}
