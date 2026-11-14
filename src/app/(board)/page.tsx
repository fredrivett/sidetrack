import { Kanban } from "@/components/Kanban";
import { listCategories } from "@/core/categories";
import { getDb } from "@/core/db";
import { projectRefPrefixes } from "@/core/itemRef";
import { listItems } from "@/core/items";
import { listAssignees, listPendingInvites } from "@/core/members";
import { listAllPrLinks } from "@/core/prLinks";
import { listProjects } from "@/core/projects";
import type { ItemPrLink } from "@/core/schema";
import { requireUserId } from "@/auth/session";

export const dynamic = "force-dynamic";

export default async function Home() {
  const userId = await requireUserId();
  const { db } = getDb();
  // Tag each project with whether the viewer owns it (vs. it being shared with
  // them) for the badge and owner-only gating, plus its display ref-prefix —
  // qualified (alice/SID) only when a shared project's prefix clashes on this
  // viewer's board, bare (SID) otherwise.
  const refPrefixes = projectRefPrefixes(db, userId);
  const projects = listProjects(db, userId).map((p) => ({
    ...p,
    isOwner: p.userId === userId,
    refPrefix: refPrefixes[p.id] ?? p.prefix,
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
  // Who each project's items can be assigned to: its owner + accepted members.
  const assigneesByProject = Object.fromEntries(
    projects.map((p) => [p.id, listAssignees(db, userId, p.id)]),
  );
  const prLinksByItem: Record<string, ItemPrLink[]> = {};
  for (const link of listAllPrLinks(db, userId)) {
    (prLinksByItem[link.itemId] ??= []).push(link);
  }

  return (
    <Kanban
      viewerId={userId}
      projects={projects}
      itemsByProject={itemsByProject}
      categoriesByProject={categoriesByProject}
      assigneesByProject={assigneesByProject}
      prLinksByItem={prLinksByItem}
      pendingInvites={pendingInvites}
    />
  );
}
