import { AgentSessionsProvider } from "@/components/agent-sessions";
import { Kanban } from "@/components/Kanban";
import { listAllAgentSessions } from "@/core/agentSessions";
import { listCategories } from "@/core/categories";
import { getDb } from "@/core/db";
import { projectRefPrefixes } from "@/core/itemRef";
import { listItems, reopenDueRepeats } from "@/core/items";
import { listAssignees, listPendingInvites } from "@/core/members";
import { listAllPrLinks } from "@/core/prLinks";
import { listProjects } from "@/core/projects";
import { getProfile, getTimeZone } from "@/core/users";
import { weekStartBound } from "@/lib/time";
import type { ItemPrLink } from "@/core/schema";
import { requireUserId } from "@/auth/session";

export const dynamic = "force-dynamic";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ view?: string | string[] }>;
}) {
  const { view } = await searchParams;
  const userId = await requireUserId();
  const { db } = getDb();
  // Repeating items whose next due day has come reopen as the page loads.
  reopenDueRepeats(db, userId);
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
  // Finished items stay on the board until their week is over (in each
  // list's Done), so leave older ones out. The browser trims to its own week
  // start (ProjectColumn); this cut is early enough for any timezone.
  const timeZone = getTimeZone(db, userId);
  const completedSince = weekStartBound(timeZone ?? undefined);
  const itemsByProject = Object.fromEntries(
    projects.map((p) => [
      p.id,
      listItems(db, userId, p.id, { includeCompleted: true, completedSince }),
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
    // Agents' work sessions reach every row and detail dialog in every view.
    <AgentSessionsProvider sessions={listAllAgentSessions(db, userId)}>
      <Kanban
        viewerId={userId}
        viewer={getProfile(db, userId)}
        timeZone={timeZone}
        initialView={
          view === "today" || view === "no-date" || view === "done" ? view : "board"
        }
        projects={projects}
        itemsByProject={itemsByProject}
        completedSince={completedSince}
        categoriesByProject={categoriesByProject}
        assigneesByProject={assigneesByProject}
        prLinksByItem={prLinksByItem}
        pendingInvites={pendingInvites}
      />
    </AgentSessionsProvider>
  );
}
