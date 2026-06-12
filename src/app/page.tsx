import { Kanban } from "@/components/Kanban";
import { listCategories } from "@/core/categories";
import { getDb } from "@/core/db";
import { listItems } from "@/core/items";
import { listPendingInvites } from "@/core/members";
import { listAllPrLinks } from "@/core/prLinks";
import { listProjects } from "@/core/projects";
import type { ItemPrLink } from "@/core/schema";
import { requireUserId } from "@/auth/session";

export const dynamic = "force-dynamic";

export default async function Home() {
  const userId = await requireUserId();
  const { db } = getDb();
  // Tag each project with whether the viewer owns it (vs. it being shared with
  // them), so the UI can badge shared projects and gate owner-only actions.
  const projects = listProjects(db, userId).map((p) => ({
    ...p,
    isOwner: p.userId === userId,
  }));
  const pendingInvites = listPendingInvites(db, userId);
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
  for (const link of listAllPrLinks(db, userId)) {
    (prLinksByItem[link.itemId] ??= []).push(link);
  }

  return (
    <Kanban
      projects={projects}
      itemsByProject={itemsByProject}
      categoriesByProject={categoriesByProject}
      prLinksByItem={prLinksByItem}
      pendingInvites={pendingInvites}
    />
  );
}
