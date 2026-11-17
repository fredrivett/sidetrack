import { cookies } from "next/headers";
import { AgentSessionsProvider } from "@/components/agent-sessions";
import { Kanban } from "@/components/Kanban";
import { LiveUpdates } from "@/components/LiveUpdates";
import {
  listAllAgentSessions,
  listStartableAgents,
  listStartableLists,
} from "@/core/agentSessions";
import { listLabels } from "@/core/labels";
import { getDb } from "@/core/db";
import { projectRefPrefixes } from "@/core/itemRef";
import { listItems, reopenDueRepeats } from "@/core/items";
import { listNotificationLevels, listNotifications } from "@/core/notifications";
import { listFollowedItemIds } from "@/core/follows";
import { listAssignees, listPendingInvites } from "@/core/members";
import { listAllPrLinks, suggestedRepositories } from "@/core/prLinks";
import { listProjects } from "@/core/projects";
import { listPendingSpaceInvites, listSpaces, listTrays } from "@/core/spaces";
import { COLLAPSED_TRAYS_COOKIE, parseCollapsedTrays } from "@/components/SpaceTray";
import { getBoardFilters, getOverdueCollapsed, getProfile, getTimeZone } from "@/core/users";
import { getEnv } from "@/lib/env";
import { cookieLocale, dayOf, LOCALE_COOKIE, startOfDayIn, weekStartBound } from "@/lib/time";
import { ServerTodayProvider } from "@/components/use-day-start";
import type { ItemPrLink } from "@/core/schema";
import { requireUserId } from "@/auth/session";

export const dynamic = "force-dynamic";

/** The viewer's day in their saved timezone, as their browser will have it. */
function todayIn(timeZone: string) {
  return dayOf(Date.now(), timeZone);
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{
    view?: string | string[];
    p?: string | string[];
    item?: string | string[];
  }>;
}) {
  const { view, p, item } = await searchParams;
  const userId = await requireUserId();
  const { db } = getDb();
  // Repeating items whose next due day has come reopen as the page loads.
  reopenDueRepeats(db, userId);
  // Tag each project with whether the viewer owns it (vs. it being shared with
  // them) for the badge and owner-only gating, plus its display ref-prefix —
  // qualified (alice/SID) only when a shared project's prefix clashes on this
  // viewer's board, bare (SID) otherwise.
  const refPrefixes = projectRefPrefixes(db, userId);
  const repoSuggestions = suggestedRepositories(db, userId);
  const projects = listProjects(db, userId).map((p) => ({
    ...p,
    isOwner: p.userId === userId,
    refPrefix: refPrefixes[p.id] ?? p.prefix,
    suggestedRepository: repoSuggestions[p.id],
  }));
  const pendingInvites = listPendingInvites(db, userId);
  // Finished items stay on the board until their week is over (in each
  // list's Done), so leave older ones out. The browser trims to its own week
  // start (ProjectColumn); this cut is early enough for any timezone.
  const timeZone = getTimeZone(db, userId);
  const completedSince = weekStartBound(timeZone ?? undefined);
  const serverToday = timeZone ? todayIn(timeZone) : null;
  const cookieStore = await cookies();
  const itemsByProject = Object.fromEntries(
    projects.map((p) => [
      p.id,
      listItems(db, userId, p.id, { includeCompleted: true, completedSince }),
    ]),
  );
  const labelsByProject = Object.fromEntries(
    projects.map((p) => [p.id, listLabels(db, userId, p.id)]),
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
    // The viewer's day (and when it began) in their saved timezone, and their
    // browser's locale, so due labels and each list's split of today's done
    // items render on the server as the browser will have them.
    <ServerTodayProvider
      today={serverToday}
      dayStart={timeZone ? startOfDayIn(timeZone) : null}
      locale={cookieLocale(cookieStore.get(LOCALE_COOKIE)?.value)}
    >
      {/* Agents' work sessions reach every row and detail dialog in every view. */}
      <AgentSessionsProvider
        sessions={listAllAgentSessions(db, userId)}
        viewerId={userId}
        startable={listStartableAgents(db, userId)}
        startableIn={listStartableLists(db, userId)}
      >
        <Kanban
          viewerId={userId}
          viewer={getProfile(db, userId)}
          timeZone={timeZone}
          overdueCollapsed={getOverdueCollapsed(db, userId)}
          initialView={
            view === "agenda" || view === "done" || view === "archived"
              ? view
              : // Links from before Today and No date became Agenda.
                view === "today" || view === "no-date"
                ? "agenda"
                : "board"
          }
          projects={projects}
          itemsByProject={itemsByProject}
          completedSince={completedSince}
          labelsByProject={labelsByProject}
          assigneesByProject={assigneesByProject}
          prLinksByItem={prLinksByItem}
          pendingInvites={pendingInvites}
          spaces={listSpaces(db, userId)}
          trayOrder={listTrays(db, userId)}
          pendingSpaceInvites={listPendingSpaceInvites(db, userId)}
          initialListId={typeof p === "string" ? p : null}
          initialItemId={typeof item === "string" ? item : null}
          notifications={listNotifications(db, userId)}
          followedItemIds={listFollowedItemIds(db, userId)}
          notificationLevels={listNotificationLevels(db, userId)}
          initialCollapsedTrays={parseCollapsedTrays(
            cookieStore.get(COLLAPSED_TRAYS_COOKIE)?.value,
          )}
          filters={getBoardFilters(db, userId)}
          aiEnabled={Boolean(getEnv().TYPESAFE_API_KEY)}
        />
        <LiveUpdates />
      </AgentSessionsProvider>
    </ServerTodayProvider>
  );
}
