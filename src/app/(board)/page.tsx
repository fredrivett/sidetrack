import { cookies, headers } from "next/headers";
import { limitedListsById, listAccessById } from "@/core/access";
import { AgentSessionsProvider } from "@/components/agent-sessions";
import { CommentCountsProvider } from "@/components/comment-counts";
import { Kanban } from "@/components/Kanban";
import {
  listAllAgentSessions,
  listStartableAgents,
  listStartableLists,
} from "@/core/agentSessions";
import { changeSeq } from "@/core/changes";
import { countCommentsByItem } from "@/core/comments";
import { sharedDayNote } from "@/core/dayNotes";
import { daysSharedWhole, dayOnWholeLists, myDayView, pendingDayShares } from "@/core/dayShares";
import { listInvitations } from "@/core/invitations";
import { listLabels } from "@/core/labels";
import { getDb } from "@/core/db";
import { projectRefPrefixes } from "@/core/itemRef";
import { getItemWithSubItems, hiddenParentTitles, listItems, reopenDueRepeats } from "@/core/items";
import { listNotificationLevels, listNotifications } from "@/core/notifications";
import { listFollowedItemIds } from "@/core/follows";
import { listAssignees, listPendingInvites } from "@/core/members";
import { listAllPrLinks, suggestedRepositories } from "@/core/prLinks";
import { listProjects } from "@/core/projects";
import { listPendingSources } from "@/core/sources";
import { listPendingSpaceInvites, listSpaces, listTrays } from "@/core/spaces";
import { COLLAPSED_TRAYS_COOKIE, parseCollapsedTrays } from "@/components/SpaceTray";
import { getGetStarted } from "@/core/getStarted";
import { loadPosts, postsToShow } from "@/lib/changelog";
import { getSeenPosts, getBoardFilters, getNoDateCollapsed, getNoDateFoldedLists, getOverdueCollapsed, getProfile, getTimeZone } from "@/core/users";
import { getEnv } from "@/lib/env";
import { cookieLocale, dayOf, LOCALE_COOKIE, startOfDayIn, startOfWeekIn, weekStartBound } from "@/lib/time";
import { ServerTodayProvider } from "@/components/use-day-start";
import type { ItemPrLink } from "@/core/schema";
import { requireUserId } from "@/auth/session";
import { PostHogIdentify } from "@/components/PostHogIdentify";
import type { CheckIn } from "@/components/CheckInsView";
import { listReactions, reactionKey } from "@/core/reactions";

export const dynamic = "force-dynamic";

/** The viewer's day in their saved timezone, as their browser will have it. */
function todayIn(timeZone: string) {
  return dayOf(Date.now(), timeZone);
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{
    /** A list to show, from a link (a push); the board keeps it in this tab after. */
    p?: string | string[];
    item?: string | string[];
    /** With item, an Activity row to open at (a push about someone's change). */
    activity?: string | string[];
    open?: string | string[];
  }>;
}) {
  const { p, item, activity, open } = await searchParams;
  // From the path (/brief, /board, …), which the proxy passes in a header.
  const view = (await headers()).get("x-board-view");
  const userId = await requireUserId();
  const { db } = getDb();
  // Repeating items whose next due day has come reopen as the page loads.
  reopenDueRepeats(db, userId);
  // Read before anything the page shows, so the page has every change up to it.
  const seq = changeSeq();
  // Tag each project with whether the viewer owns it (vs. it being shared with
  // them) for the badge and owner-only gating, plus its display ref-prefix —
  // qualified (alice/SID) only when a shared project's prefix clashes on this
  // viewer's board, bare (SID) otherwise.
  const refPrefixes = projectRefPrefixes(db, userId);
  const repoSuggestions = suggestedRepositories(db, userId);
  const access = listAccessById(db, userId);
  const limited = limitedListsById(db, userId);
  const allProjects = listProjects(db, userId).map((p) => ({
    ...p,
    isOwner: p.userId === userId,
    access: access.get(p.id) ?? "view",
    onlyItemsOf: limited.get(p.id) ?? null,
    refPrefix: refPrefixes[p.id] ?? p.prefix,
    suggestedRepository: repoSuggestions[p.id],
  }));
  // Lists shown for someone's today or week follow their day, on Check-ins,
  // rather than sit on this board.
  const shownForDay = (id: string) => Boolean(limited.get(id)?.within);
  const projects = allProjects.filter((p) => !shownForDay(p.id));
  const checkIns = new Map<string, CheckIn>();
  for (const p of allProjects) {
    const l = limited.get(p.id);
    if (!l?.within || p.status !== "active") continue;
    const c = checkIns.get(l.personId) ?? {
      personId: l.personId,
      username: l.username,
      name: l.name,
      image: l.image,
      within: l.within,
      day: l.day ?? "",
      startsAt: l.startsAt ?? 0,
      today: l.today ?? "",
      ...sharedDayNote(db, userId, l.personId),
      lists: [],
      alsoItemIds: dayOnWholeLists(db, userId, l.personId, l.within),
    };
    c.lists.push(p);
    checkIns.set(l.personId, c);
  }
  // And days shared without places of their own: on the lists the viewer sees whole.
  const sharedWhole = daysSharedWhole(db, userId);
  for (const d of sharedWhole) {
    if (checkIns.has(d.personId)) continue;
    checkIns.set(d.personId, {
      personId: d.personId,
      username: d.username,
      name: d.name,
      image: d.image,
      within: d.within,
      day: d.day,
      startsAt: d.startsAt,
      today: d.today,
      ...sharedDayNote(db, userId, d.personId),
      lists: [],
      alsoItemIds: dayOnWholeLists(db, userId, d.personId, d.within),
    });
  }
  // The viewer's own day, as the people they share it with see it.
  const ownDay = myDayView(db, userId);
  // The reactions on each day's note and wrap-up, today's, in one read.
  const days = [
    ...[...checkIns.values()].map((c) => `${c.personId}:${c.today}`),
    `${userId}:${ownDay.today}`,
  ];
  const dayReactions = listReactions(db, userId, days.flatMap((id) => [{ type: "day_note" as const, id }, { type: "wrap_up" as const, id }]));
  const reactionsOn = (id: string) => ({
    note: dayReactions[reactionKey({ type: "day_note", id })] ?? [],
    wrapUp: dayReactions[reactionKey({ type: "wrap_up", id })] ?? [],
  });
  for (const c of checkIns.values()) c.reactions = reactionsOn(`${c.personId}:${c.today}`);
  const myDay = { ...ownDay, reactions: reactionsOn(`${userId}:${ownDay.today}`) };
  const pendingInvites = listPendingInvites(db, userId);
  // Finished items stay on the board until their week is over (in each
  // list's Done), so leave older ones out. The browser trims to its own week
  // start (ProjectColumn); this cut is early enough for any timezone.
  const timeZone = getTimeZone(db, userId);
  const viewer = getProfile(db, userId);
  const completedSince = weekStartBound(timeZone ?? undefined);
  const serverToday = timeZone ? todayIn(timeZone) : null;
  const cookieStore = await cookies();
  const itemsByProject = Object.fromEntries(
    allProjects.map((p) => [
      p.id,
      listItems(db, userId, p.id, { includeCompleted: true, completedSince }),
    ]),
  );
  const labelsByProject = Object.fromEntries(
    projects.map((p) => [p.id, listLabels(db, userId, p.id)]),
  );
  // Who each project's items can be assigned to: its owner + accepted members.
  const assigneesByProject = Object.fromEntries(
    allProjects.map((p) => [p.id, listAssignees(db, userId, p.id)]),
  );
  const prLinksByItem: Record<string, ItemPrLink[]> = {};
  for (const link of listAllPrLinks(db, userId)) {
    (prLinksByItem[link.itemId] ??= []).push(link);
  }

  return (
    // The viewer's day (and when it and its week began) in their saved
    // timezone, and their browser's locale, so due labels and each list's
    // split of its done items render on the server as the browser will have them.
    <ServerTodayProvider
      today={serverToday}
      dayStart={timeZone ? startOfDayIn(timeZone) : null}
      weekStart={timeZone ? startOfWeekIn(timeZone) : null}
      locale={cookieLocale(cookieStore.get(LOCALE_COOKIE)?.value)}
    >
      {/* Agents' work sessions reach every row and detail dialog in every view. */}
      <AgentSessionsProvider
        sessions={listAllAgentSessions(db, userId)}
        viewerId={userId}
        startable={listStartableAgents(db, userId)}
        startableIn={listStartableLists(db, userId)}
      >
        <CommentCountsProvider counts={countCommentsByItem(db, userId)}>
          <Kanban
            viewerId={userId}
            viewer={viewer}
            timeZone={timeZone}
            overdueCollapsed={getOverdueCollapsed(db, userId)}
            noDateCollapsed={getNoDateCollapsed(db, userId)}
            noDateFoldedLists={getNoDateFoldedLists(db, userId)}
            getStarted={getGetStarted(db, userId, { push: Boolean(getEnv().VAPID) })}
            posts={postsToShow(loadPosts(), getSeenPosts(db, userId), new Date().toISOString().slice(0, 10))}
            initialView={
              view === "board" || view === "done" || view === "archived" || view === "check-ins" ? view : "brief"
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
            pendingPhotos={listPendingSources(db, userId)}
            checkIns={[...checkIns.values()]}
            myDay={myDay}
            dayShareInvites={pendingDayShares(db, userId)}
            // Invite people's; Check-ins lists those sharing a day.
            joinInvites={listInvitations(db, userId).filter((i) => !i.within)}
            parentTitles={hiddenParentTitles(db, userId)}
            // Someone's day it shows only part of turns over: what's on it changes.
            refreshAt={Math.min(...[...limited.values(), ...sharedWhole].map((l) => l.turnsAt ?? Infinity)) || null}
            initialListId={typeof p === "string" ? p : null}
            initialItemId={typeof item === "string" ? item : null}
            initialActivityId={typeof item === "string" && typeof activity === "string" ? activity : null}
            // A link elsewhere (Profile's Invites) can open one of the board's invite dialogs.
            initialOpen={open === "invite" || open === "share-day" ? open : null}
          // A push can link to an item not loaded with the board.
          initialItemExtra={
            typeof item === "string" &&
            !Object.values(itemsByProject).some((list) => list.some((i) => i.id === item))
              ? getItemWithSubItems(db, userId, item)
              : []
          }
            notifications={listNotifications(db, userId)}
            followedItemIds={listFollowedItemIds(db, userId)}
            notificationLevels={listNotificationLevels(db, userId)}
            initialCollapsedTrays={parseCollapsedTrays(
              cookieStore.get(COLLAPSED_TRAYS_COOKIE)?.value,
            )}
            filters={getBoardFilters(db, userId)}
            aiEnabled={Boolean(getEnv().TYPESAFE_API_KEY)}
            feedbackEnabled={Boolean(getEnv().FEEDBACK_LIST_ID)}
            admin={getEnv().ADMIN_USER_IDS.includes(userId)}
            seq={seq}
          />
        </CommentCountsProvider>
        <PostHogIdentify userId={userId} username={viewer?.displayUsername ?? null} />
      </AgentSessionsProvider>
    </ServerTodayProvider>
  );
}
