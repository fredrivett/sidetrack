import { Kanban } from "@/components/Kanban";
import { listCategories } from "@/core/categories";
import { getDb } from "@/core/db";
import { listItems } from "@/core/items";
import { listAllPrLinks } from "@/core/prLinks";
import { listProjects } from "@/core/projects";
import type { ItemPrLink } from "@/core/schema";
import { requireUserId } from "@/auth/session";

export const dynamic = "force-dynamic";

export default async function Home() {
  const userId = await requireUserId();
  const { db } = getDb();
  const projects = listProjects(db, userId);
  const itemsByProject = Object.fromEntries(
    projects.map((p) => [
      p.id,
      listItems(db, userId, p.id, { includeCompleted: true }),
    ]),
  );
  const categoriesByProject = Object.fromEntries(
    projects.map((p) => [p.id, listCategories(db, userId, p.id)]),
  );
  const prLinksByItem: Record<string, ItemPrLink[]> = {};
  for (const link of listAllPrLinks(db)) {
    (prLinksByItem[link.itemId] ??= []).push(link);
  }

  return (
    <Kanban
      projects={projects}
      itemsByProject={itemsByProject}
      categoriesByProject={categoriesByProject}
      prLinksByItem={prLinksByItem}
    />
  );
}
