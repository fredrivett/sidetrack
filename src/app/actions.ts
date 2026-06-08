"use server";

import { revalidatePath } from "next/cache";
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
  createProject as createProjectCore,
  deleteProject as deleteProjectCore,
  reorderProject as reorderProjectCore,
  updateProject as updateProjectCore,
} from "@/core/projects";
import type { AuditSource, ItemKind, ProjectStatus } from "@/core/schema";
import { requireUserId } from "@/auth/session";

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
  patch: { name?: string; status?: ProjectStatus; summary?: string },
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
