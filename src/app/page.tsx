import { Kanban } from "@/components/Kanban";
import { listCategories } from "@/core/categories";
import { getDb } from "@/core/db";
import { listItems } from "@/core/items";
import { listProjects } from "@/core/projects";

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

  return (
    <Kanban
      projects={projects}
      itemsByProject={itemsByProject}
      categoriesByProject={categoriesByProject}
    />
  );
}
