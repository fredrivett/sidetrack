"use server";

import { revalidatePath } from "next/cache";
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

const SOURCE: AuditSource = "web";

function refresh() {
  revalidatePath("/");
}

export async function createProjectAction(name: string) {
  const { db } = getDb();
  const p = createProjectCore(db, { name }, SOURCE);
  refresh();
  return p;
}

export async function updateProjectAction(
  id: string,
  patch: { name?: string; status?: ProjectStatus; summary?: string },
) {
  const { db } = getDb();
  const p = updateProjectCore(db, id, patch, SOURCE);
  refresh();
  return p;
}

export async function reorderProjectAction(id: string, ref: string) {
  const { db } = getDb();
  const p = reorderProjectCore(db, id, ref, SOURCE);
  refresh();
  return p;
}

export async function deleteProjectAction(id: string) {
  const { db } = getDb();
  deleteProjectCore(db, id, SOURCE);
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
  const { db } = getDb();
  const it = addItemCore(db, input, SOURCE);
  refresh();
  return it;
}

export async function updateItemAction(
  id: string,
  patch: { title?: string; description?: string | null; category?: string | null },
) {
  const { db } = getDb();
  const it = updateItemCore(db, id, patch, SOURCE);
  refresh();
  return it;
}

export async function completeItemAction(id: string) {
  const { db } = getDb();
  const it = completeItemCore(db, id, SOURCE);
  refresh();
  return it;
}

export async function uncompleteItemAction(id: string) {
  const { db } = getDb();
  const it = uncompleteItemCore(db, id, SOURCE);
  refresh();
  return it;
}

export async function reorderItemAction(id: string, ref: string) {
  const { db } = getDb();
  const it = reorderItemCore(db, id, ref, SOURCE);
  refresh();
  return it;
}

export async function deleteItemAction(id: string) {
  const { db } = getDb();
  deleteItemCore(db, id, SOURCE);
  refresh();
}

export async function addCategoryAction(projectId: string, name: string) {
  const { db } = getDb();
  const c = addCategoryCore(db, projectId, name, SOURCE);
  refresh();
  return c;
}

export async function listCategoriesAction(projectId: string) {
  const { db } = getDb();
  return listCategoriesCore(db, projectId);
}

export async function listAuditAction(opts: {
  projectId?: string;
  source?: AuditSource;
  limit?: number;
} = {}) {
  const { db } = getDb();
  return listAuditCore(db, opts);
}
