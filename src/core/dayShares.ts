// The days a person shares (Share my day): one per person they share with,
// across the lists and Spaces it covers. Underneath, each is a membership
// limited to the sharer's items and a window (only_assigned_to and
// only_within on project_members and space_members), so changing one changes
// every membership it's made of, through setMemberRole and
// setSpaceMemberRole, which audit each. A day shared with someone who
// already sees lists of the sharer's whole, without picking any place, is a
// day_shares row instead (shareDay): what it shows is their day on those
// lists (dayOnWholeLists). Either way the viewer accepts it once
// (acceptDayShare), and can stop seeing it (leaveDayShare).

import { nanoid } from "nanoid";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { splitDayNote } from "../lib/dayTags";
import { dayOf, nextDayStartIn, startOfWeekIn } from "../lib/time";
import { hasProjectAccess, hasWholeListAccess, inDayOf } from "./access";
import { getDayNote } from "./dayNotes";
import { listInvitations } from "./invitations";
import { validZone } from "./db-functions";
import { type AuditOrigin, recordAudit } from "./audit";
import { users } from "./auth-schema";
import type { Db } from "./db";
import { acceptInvite, declineInvite, findUserByHandle, getUserById, personAt, removeMember, setMemberRole } from "./members";
import { dayShares, items, type ListRole, type OnlyWithin, projectMembers, projects, type SpaceRole, spaceMembers, spaces } from "./schema";
import { acceptSpaceInvite, declineSpaceInvite, removeSpaceMember, setSpaceMemberRole } from "./spaces";

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
  /** Shared without places of its own (a day_shares row), on the lists they see whole. */
  withoutPlaces: boolean;
};

/** The day_shares row between them, if any. */
function rowOf(db: Db, sharerId: string, viewerId: string) {
  return db
    .select()
    .from(dayShares)
    .where(and(eq(dayShares.sharerId, sharerId), eq(dayShares.viewerId, viewerId)))
    .get();
}

const who = (db: Db, id: string) => personAt(getUserById(db, id) ?? { id, username: null });

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
  const own = db.select().from(dayShares).where(eq(dayShares.sharerId, userId)).all();
  if (all.length === 0 && own.length === 0) return [];
  const people = new Map(
    db
      .select({ id: users.id, username: users.username, name: users.name, image: users.image })
      .from(users)
      .where(inArray(users.id, [...new Set([...all.map((r) => r.personId), ...own.map((r) => r.viewerId)])]))
      .all()
      .map((u) => [u.id, u]),
  );
  const byPerson = new Map<string, DayShare>();
  const shareWith = (personId: string): DayShare => {
    const u = people.get(personId);
    return (
      byPerson.get(personId) ?? {
        personId,
        username: u?.username ?? null,
        name: u?.name || (u?.username ? `@${u.username}` : "someone"),
        image: u?.image ?? null,
        within: "today" as OnlyWithin,
        note: false,
        mood: false,
        pending: true,
        places: [],
        withoutPlaces: false,
      }
    );
  };
  for (const r of own) {
    const s = shareWith(r.viewerId);
    if (r.within === "week") s.within = "week";
    s.note ||= r.shareNote;
    s.mood ||= r.shareMood;
    s.pending &&= r.status !== "accepted";
    s.withoutPlaces = true;
    byPerson.set(r.viewerId, s);
  }
  for (const r of all) {
    const s = shareWith(r.personId);
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
  const own = rowOf(db, userId, personId);
  if (found.length === 0 && !own) throw new Error("you don't share your day with them");
  const share = change.note === undefined && change.mood === undefined ? undefined : { note: change.note, mood: change.mood };
  db.transaction((tx) => {
    if (own) {
      const set = {
        ...(change.within !== undefined && change.within !== own.within ? { within: change.within } : {}),
        ...(change.note !== undefined && change.note !== own.shareNote ? { shareNote: change.note } : {}),
        ...(change.mood !== undefined && change.mood !== own.shareMood ? { shareMood: change.mood } : {}),
      };
      if (Object.keys(set).length) {
        tx.update(dayShares).set(set).where(eq(dayShares.id, own.id)).run();
        recordAudit(tx as unknown as Db, {
          actor: userId,
          source,
          event: { type: "day_share.updated", shareId: own.id, viewer: who(tx as unknown as Db, personId), ...set },
        });
      }
    }
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
  endDayShare(db, userId, personId, userId, source);
}

/**
 * Stop seeing `sharerId`'s day, as the person it's shared with: like the
 * sharer stopping it, it ends, and they leave every place it covered. They
 * keep the lists and Spaces they're in whole. Sharing it again starts over.
 */
export function leaveDayShare(db: Db, viewerId: string, sharerId: string, source: AuditOrigin): void {
  endDayShare(db, sharerId, viewerId, viewerId, source);
}

function endDayShare(db: Db, sharerId: string, viewerId: string, actor: string, source: AuditOrigin): void {
  const found = rows(db, sharerId, viewerId);
  const own = rowOf(db, sharerId, viewerId);
  if (found.length === 0 && !own) throw new Error(actor === sharerId ? "you don't share your day with them" : "they don't share their day with you");
  db.transaction((tx) => {
    if (own) {
      tx.delete(dayShares).where(eq(dayShares.id, own.id)).run();
      recordAudit(tx as unknown as Db, {
        actor,
        source,
        event: {
          type: "day_share.removed",
          shareId: own.id,
          sharer: who(tx as unknown as Db, sharerId),
          viewer: who(tx as unknown as Db, viewerId),
          how: actor === sharerId ? "stopped" : "left",
        },
      });
    }
    for (const r of found) {
      if (r.kind === "list") removeMember(tx as unknown as Db, actor, r.placeId, viewerId, source);
      else removeSpaceMember(tx as unknown as Db, actor, r.placeId, viewerId, source);
    }
  });
}

/**
 * Lists `viewerId` sees whole that `sharerId` is on too, active ones: what
 * a day shared with them shows without picking any place
 * (dayOnWholeLists), which Share my day lists as already shared.
 */
export function listsSharedWhole(db: Db, sharerId: string, viewerId: string) {
  if (sharerId === viewerId) return [];
  return db
    .select({ id: projects.id, name: projects.name, icon: projects.icon, homepageUrl: projects.homepageUrl, spaceId: projects.spaceId })
    .from(projects)
    .where(and(eq(projects.status, "active"), hasWholeListAccess(viewerId), hasProjectAccess(sharerId)))
    .orderBy(projects.name)
    .all();
}

/**
 * What Share my day shows as already shared with `viewerId`: the Spaces
 * they're both in, which `viewerId` sees whole (so none of it can be picked
 * for them), and the lists of listsSharedWhole, each with its Space when
 * it's in one of those.
 */
export function alreadyShared(db: Db, sharerId: string, viewerId: string) {
  const both = (userId: string, whole: boolean) =>
    db
      .select({ id: spaceMembers.spaceId })
      .from(spaceMembers)
      .where(
        and(
          eq(spaceMembers.userId, userId),
          eq(spaceMembers.status, "accepted"),
          ...(whole ? [sql`${spaceMembers.onlyAssignedTo} is null`] : []),
        ),
      )
      .all()
      .map((r) => r.id);
  const mine = new Set(both(sharerId, false));
  const ids = sharerId === viewerId ? [] : both(viewerId, true).filter((id) => mine.has(id));
  const shared = ids.length
    ? db.select({ id: spaces.id, name: spaces.name, icon: spaces.icon }).from(spaces).where(inArray(spaces.id, ids)).orderBy(spaces.name).all()
    : [];
  const inShared = new Set(shared.map((s) => s.id));
  return {
    spaces: shared,
    lists: listsSharedWhole(db, sharerId, viewerId).map((l) => ({ ...l, spaceId: l.spaceId && inShared.has(l.spaceId) ? l.spaceId : null })),
  };
}

/**
 * Share the user's day with `person` without picking any place: they see
 * the user's items in it on the lists they already see whole
 * (listsSharedWhole), and the day note's words or mood if chosen, once they
 * accept. Refused when there are no such lists (pick a place to share from
 * instead, with invitePeople) or the user already shares their day with them.
 */
export function shareDay(
  db: Db,
  userId: string,
  input: { person: string; within: OnlyWithin; note?: boolean; mood?: boolean },
  source: AuditOrigin,
): { shareId: string; personId: string; lists: string[] } {
  const target = findUserByHandle(db, input.person);
  if (!target) throw new Error(`no account found for "${input.person.trim()}"`);
  if (target.id === userId) throw new Error("you can't share your day with yourself");
  if (rowOf(db, userId, target.id) || rows(db, userId, target.id).length) {
    throw new Error("you already share your day with them");
  }
  const lists = listsSharedWhole(db, userId, target.id);
  if (lists.length === 0) throw new Error("you don't share any lists with them yet: choose where your day comes from");
  const shareId = nanoid(12);
  db.transaction((tx) => {
    tx.insert(dayShares)
      .values({ id: shareId, sharerId: userId, viewerId: target.id, within: input.within, shareNote: !!input.note, shareMood: !!input.mood, createdAt: Date.now() })
      .run();
    recordAudit(tx as unknown as Db, {
      actor: userId,
      source,
      event: {
        type: "day_share.invited",
        shareId,
        viewer: personAt(target),
        within: input.within,
        ...(input.note ? { shareNote: true as const } : {}),
        ...(input.mood ? { shareMood: true as const } : {}),
      },
    });
  });
  return { shareId, personId: target.id, lists: lists.map((l) => l.name) };
}

/** Pending day memberships `sharerId` invited `viewerId` to, and their day_shares row if pending. */
function waiting(db: Db, sharerId: string, viewerId: string) {
  const places = rows(db, sharerId, viewerId).filter((r) => r.status === "pending");
  const own = rowOf(db, sharerId, viewerId);
  return { places, own: own?.status === "pending" ? own : undefined };
}

/** Accept `sharerId`'s shared day, as the person it's shared with: every part of it waiting, at once. */
export function acceptDayShare(db: Db, viewerId: string, sharerId: string, source: AuditOrigin): void {
  const { places, own } = waiting(db, sharerId, viewerId);
  if (!own && places.length === 0) throw new Error("no shared day waiting from them");
  db.transaction((tx) => {
    if (own) {
      tx.update(dayShares).set({ status: "accepted" }).where(eq(dayShares.id, own.id)).run();
      recordAudit(tx as unknown as Db, {
        actor: viewerId,
        source,
        event: { type: "day_share.joined", shareId: own.id, sharer: who(tx as unknown as Db, sharerId) },
      });
    }
    for (const r of places) {
      if (r.kind === "list") acceptInvite(tx as unknown as Db, viewerId, r.placeId, source);
      else acceptSpaceInvite(tx as unknown as Db, viewerId, r.placeId, source);
    }
  });
}

/** Decline `sharerId`'s shared day: every part of it waiting. */
export function declineDayShare(db: Db, viewerId: string, sharerId: string, source: AuditOrigin): void {
  const { places, own } = waiting(db, sharerId, viewerId);
  if (!own && places.length === 0) throw new Error("no shared day waiting from them");
  db.transaction((tx) => {
    if (own) {
      tx.delete(dayShares).where(eq(dayShares.id, own.id)).run();
      recordAudit(tx as unknown as Db, {
        actor: viewerId,
        source,
        event: { type: "day_share.declined", shareId: own.id, sharer: who(tx as unknown as Db, sharerId) },
      });
    }
    for (const r of places) {
      if (r.kind === "list") declineInvite(tx as unknown as Db, viewerId, r.placeId, source);
      else declineSpaceInvite(tx as unknown as Db, viewerId, r.placeId, source);
    }
  });
}

/** Someone whose shared day waits for `viewerId` to accept, and the places it adds. */
export type DayShareInvite = {
  personId: string;
  username: string | null;
  name: string;
  image: string | null;
  within: OnlyWithin;
  /** Places it adds, which they'd see only the sharer's day on; none when it's on lists they share. */
  places: string[];
};

/** The shared days waiting for `viewerId` to accept, one per person. */
export function pendingDayShares(db: Db, viewerId: string): DayShareInvite[] {
  const own = db
    .select({ sharerId: dayShares.sharerId, within: dayShares.within })
    .from(dayShares)
    .where(and(eq(dayShares.viewerId, viewerId), eq(dayShares.status, "pending")))
    .all();
  const placeRows = [projectMembers, spaceMembers].flatMap((m) =>
    db
      .select({ sharerId: sql<string>`${m.onlyAssignedTo}`, within: sql<OnlyWithin>`${m.onlyWithin}`, placeId: m === projectMembers ? projectMembers.projectId : spaceMembers.spaceId })
      .from(m)
      .where(and(eq(m.userId, viewerId), eq(m.status, "pending"), isNotNull(m.onlyAssignedTo), isNotNull(m.onlyWithin)))
      .all()
      .map((r) => ({ ...r, kind: m === projectMembers ? ("list" as const) : ("space" as const) })),
  );
  const names = new Map([
    ...db.select({ id: projects.id, name: projects.name }).from(projects).where(inArray(projects.id, [...placeRows.filter((r) => r.kind === "list").map((r) => r.placeId), ""])).all().map((p) => [p.id, p.name] as const),
    ...db.select({ id: spaces.id, name: spaces.name }).from(spaces).where(inArray(spaces.id, [...placeRows.filter((r) => r.kind === "space").map((r) => r.placeId), ""])).all().map((p) => [p.id, p.name] as const),
  ]);
  const byPerson = new Map<string, DayShareInvite>();
  for (const r of [...own.map((o) => ({ ...o, placeId: null })), ...placeRows]) {
    const u = getUserById(db, r.sharerId);
    const s = byPerson.get(r.sharerId) ?? {
      personId: r.sharerId,
      username: u?.username ?? null,
      name: u?.name || (u?.username ? `@${u.username}` : "someone"),
      image: u?.image ?? null,
      within: "today" as OnlyWithin,
      places: [],
    };
    if (r.within === "week") s.within = "week";
    if (r.placeId) s.places.push(names.get(r.placeId) ?? "");
    byPerson.set(r.sharerId, s);
  }
  return [...byPerson.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The days shared with `viewerId` without places of their own, accepted:
 * one Check-ins card each, of the sharer's day on the lists the viewer sees
 * whole. Their day counts from today, or the week's Monday, in their zone.
 */
export function daysSharedWhole(db: Db, viewerId: string, now = Date.now()) {
  return db
    .select({ personId: dayShares.sharerId, within: dayShares.within, username: users.username, name: users.name, image: users.image, timeZone: users.timeZone })
    .from(dayShares)
    .innerJoin(users, eq(users.id, dayShares.sharerId))
    .where(and(eq(dayShares.viewerId, viewerId), eq(dayShares.status, "accepted")))
    .all()
    .map((r) => {
      const zone = validZone(r.timeZone);
      return {
        personId: r.personId,
        username: r.username,
        name: r.name || (r.username ? `@${r.username}` : "someone"),
        image: r.image,
        within: r.within,
        day: dayOf(r.within === "week" ? startOfWeekIn(zone, now) : now, zone),
        today: dayOf(now, zone),
        turnsAt: nextDayStartIn(zone, now),
      };
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
      s.withoutPlaces ||
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
    today: dayOf(now, zone),
    note: (seen?.note && rest) || null,
    mood: seen?.mood ? tags : [],
    itemIds: seen?.itemIds ?? [],
    shares,
    // People invited by email who haven't joined yet: it's theirs once they do.
    invited: listInvitations(db, userId, now).filter((i) => i.within),
  };
}
