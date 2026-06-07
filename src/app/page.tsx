import { Kanban } from "@/components/Kanban";
import { listCategories } from "@/core/categories";
import { getDb } from "@/core/db";
import { listItems } from "@/core/items";
import { listAllPrLinks } from "@/core/prLinks";
import { listProjects } from "@/core/projects";
import type { ItemPrLink } from "@/core/schema";

export const dynamic = "force-dynamic";

export default function Home() {
  const { db } = getDb();
  const projects = listProjects(db);
  const itemsByProject = Object.fromEntries(
    projects.map((p) => [p.id, listItems(db, p.id, { includeCompleted: true })]),
  );
  const categoriesByProject = Object.fromEntries(
    projects.map((p) => [p.id, listCategories(db, p.id)]),
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
