import { nanoid } from "nanoid";
import type { AuditOrigin } from "./audit";
import type { Db } from "./db";
import { eq } from "drizzle-orm";
import { findUserByHandle, inviteMember, type MemberView } from "./members";
import { projects, spaces, type ListRole, type SpaceRole } from "./schema";
import { inviteSpaceMember, type SpaceMemberView } from "./spaces";

/** A place one invite covers, and what the people invited can do there. */
export type InvitePlace =
  | { kind: "list"; id: string; role: ListRole }
  | { kind: "space"; id: string; role: Exclude<SpaceRole, "admin"> };

/** Who was invited where: one per person and place. */
export type SentInvite =
  | { kind: "list"; placeId: string; member: MemberView }
  | { kind: "space"; placeId: string; member: SpaceMemberView };

/** A place an invite went to, by name, for telling the people invited. */
export type InvitedPlace = InvitePlace & { name: string };

/**
 * Invite several people to several lists and Spaces at once, each place
 * with its own role: as if each were invited to each separately (the same
 * checks, one audited invite per person and place), all or none. They
 * share an invite id, so the people told hear of it together (one push,
 * "Lorna invited @jo to Home and Health"), each only of the places they're
 * in themselves.
 */
export function invitePeople(
  db: Db,
  userId: string,
  input: { people: string[]; places: InvitePlace[] },
  source: AuditOrigin,
): { sent: SentInvite[]; places: InvitedPlace[] } {
  // One person typed two ways (jo, @jo, their email) is invited once;
  // a handle with no account is kept, for its "no account found".
  const byAccount = new Map<string, string>();
  for (const raw of input.people) {
    const handle = raw.trim();
    if (handle) byAccount.set(findUserByHandle(db, handle)?.id ?? `?${handle}`, handle);
  }
  const people = [...byAccount.values()];
  const places = input.places.filter(
    (p, i) => input.places.findIndex((q) => q.kind === p.kind && q.id === p.id) === i,
  );
  if (people.length === 0) throw new Error("say who to invite");
  if (places.length === 0) throw new Error("choose a list or Space to invite them to");
  const inviteId = nanoid(12);
  const sent = db.transaction((tx) =>
    people.flatMap((person) =>
      places.map((place): SentInvite =>
        place.kind === "list"
          ? {
              kind: "list",
              placeId: place.id,
              member: inviteMember(tx as unknown as Db, userId, place.id, person, source, place.role, inviteId),
            }
          : {
              kind: "space",
              placeId: place.id,
              member: inviteSpaceMember(tx as unknown as Db, userId, place.id, person, source, place.role, inviteId),
            },
      ),
    ),
  );
  // Every place was checked above (owned or administered), so has a name.
  const named = places.map((p): InvitedPlace => {
    const row =
      p.kind === "list"
        ? db.select({ name: projects.name }).from(projects).where(eq(projects.id, p.id)).get()
        : db.select({ name: spaces.name }).from(spaces).where(eq(spaces.id, p.id)).get();
    return { ...p, name: row?.name ?? "" };
  });
  return { sent, places: named };
}
