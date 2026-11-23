// The days a person shares (Share my day): one per person they share with,
// across the lists and Spaces it covers. Underneath, each is a membership
// limited to the sharer's items and a window (only_assigned_to and
// only_within on project_members and space_members), so changing one changes
// every membership it's made of, through setMemberRole and
// setSpaceMemberRole, which audit each.

import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { splitDayNote } from "../lib/dayTags";
import { dayOf, startOfWeekIn } from "../lib/time";
import { hasProjectAccess, hasWholeListAccess, inDayOf } from "./access";
import { getDayNote } from "./dayNotes";
import { listInvitations } from "./invitations";
import { validZone } from "./db-functions";
import type { AuditOrigin } from "./audit";
import { users } from "./auth-schema";
import type { Db } from "./db";
import { removeMember, setMemberRole } from "./members";
import { items, type ListRole, type OnlyWithin, projectMembers, projects, type SpaceRole, spaceMembers, spaces } from "./schema";
import { removeSpaceMember, setSpaceMemberRole } from "./spaces";

/** Someone the user shares their day with, as Check-ins lists them. */
export type DayShare = {
  personId: string;
  username: string | null;
  name: string;
  image: string | null;
  /** The widest window any of its places has. */
  within: OnlyWithin;
  note: boolean;
  mood: boolean;
  /** Not accepted anywhere yet. */
  pending: boolean;
  /** Each place it covers; pending until they accept there. */
  places: { kind: "list" | "space"; id: string; name: string; pending: boolean }[];
};

type Row = {
  kind: "list" | "space";
  placeId: string;
  placeName: string;
  role: string;
  personId: string;
  within: OnlyWithin | null;
  note: boolean;
  mood: boolean;
  status: string;
};

function rows(db: Db, userId: string, personId?: string): Row[] {
  const lists = db
    .select({
      placeId: projects.id,
      placeName: projects.name,
      role: projectMembers.role,
      personId: projectMembers.userId,
      within: projectMembers.onlyWithin,
      note: projectMembers.shareNote,
      mood: projectMembers.shareMood,
      status: projectMembers.status,
    })
    .from(projectMembers)
    .innerJoin(projects, eq(projects.id, projectMembers.projectId))
    .where(
      and(
        eq(projectMembers.onlyAssignedTo, userId),
        isNotNull(projectMembers.onlyWithin),
        ...(personId ? [eq(projectMembers.userId, personId)] : []),
      ),
    )
    .all()
    .map((r) => ({ ...r, kind: "list" as const }));
  const inSpaces = db
    .select({
      placeId: spaces.id,
      placeName: spaces.name,
      role: spaceMembers.role,
      personId: spaceMembers.userId,
      within: spaceMembers.onlyWithin,
      note: spaceMembers.shareNote,
      mood: spaceMembers.shareMood,
      status: spaceMembers.status,
    })
    .from(spaceMembers)
    .innerJoin(spaces, eq(spaces.id, spaceMembers.spaceId))
    .where(
      and(
        eq(spaceMembers.onlyAssignedTo, userId),
        isNotNull(spaceMembers.onlyWithin),
        ...(personId ? [eq(spaceMembers.userId, personId)] : []),
      ),
    )
    .all()
    .map((r) => ({ ...r, kind: "space" as const }));
  return [...lists, ...inSpaces];
}

/** Who `userId` shares their day with, each once, by name. */
export function listDayShares(db: Db, userId: string): DayShare[] {
  const all = rows(db, userId);
  if (all.length === 0) return [];
  const people = new Map(
    db
      .select({ id: users.id, username: users.username, name: users.name, image: users.image })
      .from(users)
      .where(inArray(users.id, [...new Set(all.map((r) => r.personId))]))
      .all()
      .map((u) => [u.id, u]),
  );
  const byPerson = new Map<string, DayShare>();
  for (const r of all) {
    const u = people.get(r.personId);
    const s = byPerson.get(r.personId) ?? {
      personId: r.personId,
      username: u?.username ?? null,
      name: u?.name || (u?.username ? `@${u.username}` : "someone"),
      image: u?.image ?? null,
      within: "today" as OnlyWithin,
      note: false,
      mood: false,
      pending: true,
      places: [],
    };
    if (r.within === "week") s.within = "week";
    s.note ||= r.note;
    s.mood ||= r.mood;
    s.pending &&= r.status !== "accepted";
    s.places.push({ kind: r.kind, id: r.placeId, name: r.placeName, pending: r.status !== "accepted" });
    byPerson.set(r.personId, s);
  }
  return [...byPerson.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Change what `personId` sees of the user's day, in every place it covers:
 * its window, and whether it includes the day note's words or mood. Left as
 * it is where a field is undefined.
 */
export function updateDayShare(
  db: Db,
  userId: string,
  personId: string,
  change: { within?: OnlyWithin; note?: boolean; mood?: boolean },
  source: AuditOrigin,
): void {
  const found = rows(db, userId, personId);
  if (found.length === 0) throw new Error("you don't share your day with them");
  const share = change.note === undefined && change.mood === undefined ? undefined : { note: change.note, mood: change.mood };
  db.transaction((tx) => {
    for (const r of found) {
      if (r.kind === "list") {
        setMemberRole(tx as unknown as Db, userId, r.placeId, personId, r.role as ListRole, source, true, change.within, share);
      } else {
        setSpaceMemberRole(tx as unknown as Db, userId, r.placeId, personId, r.role as SpaceRole, source, true, change.within, share);
      }
    }
  });
}

/** Stop sharing the user's day with `personId`: they leave every place it covered. */
export function stopDayShare(db: Db, userId: string, personId: string, source: AuditOrigin): void {
  const found = rows(db, userId, personId);
  if (found.length === 0) throw new Error("you don't share your day with them");
  db.transaction((tx) => {
    for (const r of found) {
      if (r.kind === "list") removeMember(tx as unknown as Db, userId, r.placeId, personId, source);
      else removeSpaceMember(tx as unknown as Db, userId, r.placeId, personId, source);
    }
  });
}

/**
 * What the user's partners see of their day, at most: those who've accepted
 * (anyone's, before anyone has, since a pending share shows nothing yet), by
 * the widest window, with the note's words or mood when any of them sees
 * those, and the ids of the user's own items in it, on the places shared and
 * the lists a partner sees whole (dayOnWholeLists). Null when they share
 * their day with nobody.
 */
export function mySharedDay(db: Db, userId: string, shares = listDayShares(db, userId)) {
  if (shares.length === 0) return null;
  const counted = shares.some((s) => !s.pending) ? shares.filter((s) => !s.pending) : shares;
  const within: OnlyWithin = counted.some((s) => s.within === "week") ? "week" : "today";
  // Where they've accepted, likewise: a pending place shows nothing yet.
  const placesOf = (s: DayShare) => (s.pending ? s.places : s.places.filter((p) => !p.pending));
  const shared = db
    .select({ id: items.id })
    .from(items)
    .innerJoin(projects, eq(projects.id, items.projectId))
    .where(and(inPlaces(counted.flatMap(placesOf)), inDayOf(userId, within)))
    .all()
    .map((r) => r.id);
  // And on the lists each of them sees whole anyway, for those it gives a
  // card on Check-ins: a list it covers that's active and they see only part of.
  const carded = counted.filter(
    (s) =>
      !!db
        .select({ id: projects.id })
        .from(projects)
        .where(and(inPlaces(placesOf(s)), eq(projects.status, "active"), sql`not (${hasWholeListAccess(s.personId)})`))
        .get(),
  );
  const itemIds = [...new Set([...shared, ...carded.flatMap((s) => dayOnWholeLists(db, s.personId, userId, within))])];
  return { within, note: counted.some((s) => s.note), mood: counted.some((s) => s.mood), itemIds };
}

/** Lists in any of these places (`projects` in scope). */
function inPlaces(places: DayShare["places"]) {
  const listIds = places.filter((p) => p.kind === "list").map((p) => p.id);
  const spaceIds = places.filter((p) => p.kind === "space").map((p) => p.id);
  return sql`(${projects.id} in (${sql.join([...listIds, ""].map((id) => sql`${id}`), sql`, `)})${spaceIds.length ? sql` or ${inArray(projects.spaceId, spaceIds)}` : sql``})`;
}

/**
 * Ids of `personId`'s items in their `within` on the active lists `viewerId`
 * sees whole, which their day shared with the viewer shows too, without
 * picking those lists: the viewer sees those items anyway, so leaving them
 * off would hide nothing, only make the day look emptier than it is.
 */
export function dayOnWholeLists(db: Db, viewerId: string, personId: string, within: OnlyWithin): string[] {
  return db
    .select({ id: items.id })
    .from(items)
    .innerJoin(projects, eq(projects.id, items.projectId))
    .where(and(eq(projects.status, "active"), hasWholeListAccess(viewerId), hasProjectAccess(personId), inDayOf(personId, within)))
    .all()
    .map((r) => r.id);
}

/**
 * The user's own shared day, as Check-ins shows it to them, the way their
 * partners see it (mySharedDay): today, or the week's Monday; their note and
 * mood today, if shared; the items in it; who sees it, and who's invited
 * to by email but hasn't joined yet.
 */
export function myDayView(db: Db, userId: string, now = Date.now()) {
  const shares = listDayShares(db, userId);
  const seen = mySharedDay(db, userId, shares);
  const within: OnlyWithin = seen?.within ?? "today";
  const zone = validZone(db.select({ tz: users.timeZone }).from(users).where(eq(users.id, userId)).get()?.tz);
  const text = seen && (seen.note || seen.mood) ? getDayNote(db, userId, dayOf(now, zone)) : null;
  const { tags, rest } = text ? splitDayNote(text) : { tags: [], rest: "" };
  return {
    within,
    day: seen ? dayOf(within === "week" ? startOfWeekIn(zone, now) : now, zone) : "",
    note: (seen?.note && rest) || null,
    mood: seen?.mood ? tags : [],
    itemIds: seen?.itemIds ?? [],
    shares,
    // People invited by email who haven't joined yet: it's theirs once they do.
    invited: listInvitations(db, userId, now).filter((i) => i.within),
  };
}
