import { and, eq, inArray } from "drizzle-orm";
import { roleWords } from "../lib/roles";
import { ITEM_SORTS } from "../lib/itemSorts";
import { repeatLabel } from "../lib/repeat";
import { dueWord } from "../lib/time";
import { users } from "./auth-schema";
import type { Db } from "./db";
import type { AccessLost, ChangeEvent, DueAt, ItemAt, ListChanges, PersonAt, SpaceAt } from "./events";
import { items, projects, spaceMembers, spaces } from "./schema";

// Turns change events (core/events.ts) into sentences. Activity, an item's
// history and MCP's list_audit all read events through here, so they say
// the same thing. Names are the current ones, so a renamed item reads as it's
// called now; the name stored on the event is for when it's gone. A rename
// itself keeps the name it had, so its row still says what changed.

/**
 * A run of a sentence. `em` marks who and what, which stand out; `quote`
 * marks a name the plain-text form puts in quotes.
 */
export interface Part {
  text: string;
  em?: "person" | "item" | "place";
  quote?: boolean;
  /** An item that's done now, which reads struck through, as on the board. */
  done?: boolean;
  /** A list the reader can open, to show with its icon and link to. */
  list?: { id: string; icon: string | null; homepageUrl: string | null };
  /** When something's due, which readers see relative to their own day
   * ("this weekend"); `text` has its dates. */
  due?: { dueDate: string; dueFrom: string | null };
}

/**
 * Current names for the things a page of events mentions. An item reads by
 * its current title only while it's still in the list the event happened
 * in: once moved, its new title is for the new list's readers, who may not
 * be this one. A Space reads by its current name only for someone in it.
 * Anything gone, moved, or out of reach reads as the event stored it.
 */
export interface Names {
  item(it: ItemAt, projectId: string): string;
  /** Whether the item is done now, when it reads by its current title. */
  done(it: ItemAt, projectId: string): boolean;
  person(p: PersonAt): string;
  list(id: string, fallback: string): string;
  space(s: SpaceAt): string;
}

/** Every id an event refers to, by the key that names it. */
type Ids = { items: Set<string>; people: Set<string>; lists: Set<string>; spaces: Set<string> };

function collect(value: unknown, into: Ids) {
  if (Array.isArray(value)) {
    for (const v of value) collect(v, into);
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (typeof v === "string") {
        if (k === "itemId") into.items.add(v);
        else if (k === "userId") into.people.add(v);
        else if (k === "projectId") into.lists.add(v);
        else if (k === "spaceId") into.spaces.add(v);
      } else {
        collect(v, into);
      }
    }
  }
}

/** Current names for `events`, as `viewer` may see them, read in one query
 * per kind of thing. */
export function namesFor(db: Db, events: ChangeEvent[], viewer: string): Names {
  const ids: Ids = { items: new Set(), people: new Set(), lists: new Set(), spaces: new Set() };
  collect(events, ids);
  const itemRows = ids.items.size
    ? db
        .select({ id: items.id, title: items.title, projectId: items.projectId, completedAt: items.completedAt })
        .from(items)
        .where(inArray(items.id, [...ids.items]))
        .all()
    : [];
  const userRows = ids.people.size
    ? db
        .select({ id: users.id, username: users.username, name: users.name, email: users.email })
        .from(users)
        .where(inArray(users.id, [...ids.people]))
        .all()
    : [];
  const listRows = ids.lists.size
    ? db
        .select({ id: projects.id, name: projects.name })
        .from(projects)
        .where(inArray(projects.id, [...ids.lists]))
        .all()
    : [];
  const spaceRows = ids.spaces.size
    ? db
        .select({ id: spaces.id, name: spaces.name })
        .from(spaces)
        .innerJoin(spaceMembers, eq(spaceMembers.spaceId, spaces.id))
        .where(
          and(
            inArray(spaces.id, [...ids.spaces]),
            eq(spaceMembers.userId, viewer),
            eq(spaceMembers.status, "accepted"),
          ),
        )
        .all()
    : [];
  const itemById = new Map(itemRows.map((r) => [r.id, r]));
  // `@username`, then name, then email.
  const people = new Map(
    userRows.map((u) => [u.id, u.username ? `@${u.username}` : (u.name ?? u.email)]),
  );
  const lists = new Map(listRows.map((r) => [r.id, r.name]));
  const spaceNames = new Map(spaceRows.map((r) => [r.id, r.name]));
  return {
    item(it, projectId) {
      const row = itemById.get(it.itemId);
      return row && row.projectId === projectId ? row.title : it.title;
    },
    done(it, projectId) {
      const row = itemById.get(it.itemId);
      return row?.projectId === projectId && row.completedAt !== null;
    },
    person: (p) => people.get(p.userId) ?? p.name,
    list: (id, fallback) => lists.get(id) ?? fallback,
    space: (sp) => spaceNames.get(sp.spaceId) ?? sp.name,
  };
}

/**
 * A sentence as plain text, names in quotes: `completed "Fix tap"`. Given
 * the reader's `today`, a due date reads in words where it can ("this
 * weekend"), else as its dates.
 */
export function plainText(parts: Part[], today?: string): string {
  return parts
    .map((p) => {
      const word = p.due && today ? dueWord(p.due.dueDate, today, p.due.dueFrom) : null;
      return word ? word.toLowerCase() : p.quote ? `"${p.text}"` : p.text;
    })
    .join("");
}

/** When something's due, as a Part (see Part.due). */
export function duePart(due: DueAt & { dueDate: string }): Part {
  return {
    text: due.dueFrom ? `${due.dueFrom} to ${due.dueDate}` : due.dueDate,
    due: { dueDate: due.dueDate, dueFrom: due.dueFrom },
  };
}

const t = (text: string): Part => ({ text });

/** Several people, comma-separated, each standing out. */
function people(names: Names, list: PersonAt[]): Part[] {
  return list.flatMap((p, i) => [
    ...(i ? [t(", ")] : []),
    { text: names.person(p), em: "person" as const },
  ]);
}

/** What losing access cleaned up, as trailing clauses. */
function lostText(lost: AccessLost | undefined): Part[] {
  if (!lost) return [];
  const n = (count: number, what: string) => `${count} ${what}${count === 1 ? "" : "s"}`;
  return [
    ...(lost.unassigned ? [t(`, unassigned from ${n(lost.unassigned, "item")}`)] : []),
    ...(lost.ended ? [t(`, ended ${n(lost.ended, "agent session")}`)] : []),
  ];
}

/** A list's changes, in the order updateProject makes them. */
function listChanges(c: ListChanges): string[] {
  const icon = {
    set: "set icon",
    changed: "changed icon",
    cleared: "cleared icon",
    chose: "chose icon",
    "chose-none": "chose no icon",
  } as const;
  const r = c.repository;
  return [
    c.name && `renamed to "${c.name.to}"`,
    c.prefix && `prefix ${c.prefix.from}→${c.prefix.to}`,
    c.status && `status ${c.status.from}→${c.status.to}`,
    c.summary && "edited summary",
    c.homepage && `${c.homepage} homepage`,
    r &&
      (r.to === null
        ? `cleared repository ${r.from}`
        : r.from
          ? `repository ${r.from}→${r.to}`
          : `set repository to ${r.to}`),
    c.icon && icon[c.icon],
    c.done && (c.done === "cleared" ? "moved done items to Done" : "moved done items back to the list"),
  ].filter((p): p is string => Boolean(p));
}

export function describeEvent(event: ChangeEvent, names: Names): Part[] {
  const projectId = "projectId" in event ? event.projectId : "";
  const item = (it: ItemAt): Part => ({
    text: names.item(it, projectId),
    em: "item",
    quote: true,
    ...(names.done(it, projectId) && { done: true }),
  });
  const person = (p: PersonAt): Part => ({ text: names.person(p), em: "person" });
  const list = (name: string): Part => ({
    text: names.list(projectId, name),
    em: "place",
    quote: true,
  });
  const space = (sp: SpaceAt): Part => ({ text: names.space(sp), em: "place", quote: true });
  // An agent, by its API key's name at the time.
  const agent = (name: string): Part => ({ text: name, em: "person" });
  const key = (name: string): Part => ({ text: name, em: "item", quote: true });
  switch (event.type) {
    case "item.created": {
      const parts: Part[] = event.parent
        ? [t("added "), item(event), t(" to "), item(event.parent)]
        : [t("added task "), item(event)];
      if (event.due.dueDate) parts.push(t(", due "), duePart({ ...event.due, dueDate: event.due.dueDate }));
      if (event.labels.length) parts.push(t(`, labelled ${event.labels.join(", ")}`));
      if (event.assignees.length) parts.push(t(", assigned to "), ...people(names, event.assignees));
      if (event.repeat) parts.push(t(`, repeats ${repeatLabel(event.repeat).replace("Every", "every")}`));
      return parts;
    }
    case "item.updated": {
      const c = event.changes;
      // A rename keeps the name it had, so the row says what it was.
      const subject: Part = c.title
        ? { text: c.title.from, em: "item" }
        : { text: names.item(event, projectId), em: "item", ...(names.done(event, projectId) && { done: true }) };
      const changes: Part[][] = [];
      if (c.title) changes.push([t(`renamed to "${c.title.to}"`)]);
      if (c.description) {
        changes.push([t(c.description === "edited" ? "edited description" : "description cleared")]);
      }
      if (c.labels?.added.length) changes.push([t(`labelled ${c.labels.added.join(", ")}`)]);
      if (c.labels?.removed.length) changes.push([t(`unlabelled ${c.labels.removed.join(", ")}`)]);
      if (c.assignees?.added.length) {
        changes.push([t("assigned "), ...people(names, c.assignees.added)]);
      }
      if (c.assignees?.removed.length) {
        changes.push([t("unassigned "), ...people(names, c.assignees.removed)]);
      }
      if (c.due) {
        changes.push(
          c.due.dueDate ? [t("due "), duePart({ ...c.due, dueDate: c.due.dueDate })] : [t("due date cleared")],
        );
      }
      if (c.repeat !== undefined) {
        changes.push([
          t(c.repeat ? `repeats ${repeatLabel(c.repeat).replace("Every", "every")}` : "no longer repeats"),
        ]);
      }
      return [
        t("updated "),
        subject,
        t(": "),
        ...changes.flatMap((p, i) => (i ? [t(", "), ...p] : p)),
      ];
    }
    case "item.completed":
      return !event.with
        ? [t("completed "), item(event)]
        : event.with.as === "last-sub-item"
          ? [t("completed "), item(event), t(" with its last sub-item, "), item(event.with)]
          : [t("completed "), item(event), t(" with "), item(event.with)];
    case "item.reopened": {
      const parts: Part[] = [t("reopened "), item(event)];
      if (event.forSubItem) parts.push(t(" for an open sub-item"));
      if (event.repeat) parts.push(t(` (repeats ${repeatLabel(event.repeat).replace("Every", "every")})`));
      if (event.with) parts.push(t(" with "), item(event.with));
      if (event.due?.dueDate) parts.push(t(", due "), duePart({ ...event.due, dueDate: event.due.dueDate }));
      return parts;
    }
    case "item.reordered":
      return [t("reordered "), item(event)];
    case "item.deleted":
      return event.with
        ? [t("deleted "), item(event), t(" with "), item(event.with)]
        : [t("deleted "), item(event)];
    case "item.nested":
      return [t("made "), item(event), t(" a sub-item of "), item(event.parent)];
    case "item.unnested":
      return [
        t("moved "),
        item(event),
        t(" out of "),
        event.parent.title === null
          ? { text: "its parent", quote: true }
          : item({ itemId: event.parent.itemId, title: event.parent.title }),
      ];
    case "list.items.sorted": {
      return event.by
        ? [t("sorted "), list(event.listName), t(` by ${ITEM_SORTS[event.by]}`)]
        : [t("reordered the items in "), list(event.listName)];
    }
    case "comment.created":
      return [t("commented on "), item(event.item)];
    case "comment.edited":
      return [t("edited a comment on "), item(event.item)];
    case "comment.deleted":
      return [t("deleted a comment on "), item(event.item)];
    case "list.created":
      return event.space
        ? [t("created list "), list(event.listName), t(" in space "), space(event.space)]
        : [t("created list "), list(event.listName)];
    case "list.updated": {
      const c = event.changes;
      // A rename keeps the name it had, so the row says what it was.
      const subject: Part = {
        text: c.name ? c.name.from : names.list(projectId, event.listName),
        em: "place",
      };
      return [t("updated "), subject, t(`: ${listChanges(c).join(", ")}`)];
    }
    case "list.reordered":
      return [t("reordered list "), list(event.listName)];
    case "list.deleted":
      return [t("deleted list "), list(event.listName)];
    case "list.space.changed": {
      const { from, to } = event;
      const moved: Part[] =
        from && to
          ? [t("moved "), list(event.listName), t(" from space "), space(from), t(" to "), space(to)]
          : from
            ? [t("took "), list(event.listName), t(" out of space "), space(from)]
            : [t("moved "), list(event.listName), t(" into space "), ...(to ? [space(to)] : [])];
      return [...moved, ...lostText(event.lost)];
    }
    case "member.invited":
      return [
        t("invited "),
        person(event.member),
        t(" to "),
        list(event.listName),
        ...(event.role && event.role !== "editor" ? [t(` as ${roleWords(event.role)}`)] : []),
      ];
    case "member.role":
      return [
        t("made "),
        person(event.member),
        t(` ${roleWords(event.role)} of `),
        list(event.listName),
        ...lostText(event.lost),
      ];
    case "member.joined":
      return [
        t("accepted invite to "),
        list(event.listName),
        ...(event.role && event.role !== "editor" ? [t(` as ${roleWords(event.role)}`)] : []),
      ];
    case "member.declined":
      return [t("declined invite to "), list(event.listName)];
    case "member.removed": {
      const what: Part[] =
        event.how === "left"
          ? [t("left "), list(event.listName)]
          : event.how === "revoked"
            ? [t("revoked invite for "), person(event.member)]
            : [t("removed "), person(event.member)];
      return [...what, ...lostText(event.lost)];
    }
    case "label.created":
      return [
        t("added label "),
        { text: event.emoji ? `${event.emoji} ${event.name}` : event.name, em: "place", quote: true },
      ];
    case "label.deleted":
      return [
        t("removed label "),
        { text: event.emoji ? `${event.emoji} ${event.name}` : event.name, em: "place", quote: true },
      ];
    case "label.updated": {
      const { name, emoji, archived } = event.changes;
      const changes = [
        name && `renamed to "${name.to}"`,
        emoji &&
          (emoji.kept
            ? emoji.to ? `chose ${emoji.to}` : "chose no emoji"
            : emoji.to ? `emoji ${emoji.to}` : "emoji removed"),
        archived !== undefined && (archived ? "archived" : "restored"),
      ].filter((p): p is string => Boolean(p));
      return [
        t("updated label "),
        { text: event.name, em: "place", quote: true },
        t(`: ${changes.join(", ")}`),
      ];
    }
    case "space.created":
      return [
        t("created space "),
        space(event),
        ...(event.color ? [t(` (${event.color})`)] : []),
      ];
    case "space.updated": {
      const c = event.changes;
      const changes = [
        c.name && `renamed to "${c.name.to}"`,
        c.icon !== undefined && (c.icon ? `icon set to ${c.icon}` : "icon cleared"),
        c.color !== undefined && (c.color ? `colour set to ${c.color}` : "colour cleared"),
      ].filter((p): p is string => Boolean(p));
      // A rename keeps the name it had, so the row says what it was.
      const subject: Part = c.name
        ? { text: c.name.from, em: "place", quote: true }
        : space(event);
      return [t("updated space "), subject, t(`: ${changes.join(", ")}`)];
    }
    case "space.deleted":
      return [t("deleted space "), space(event), ...lostText(event.lost)];
    case "space.reordered":
      // Personal is the viewer's own tray, not a Space.
      return event.spaceId === "personal"
        ? [t("reordered "), { text: "Personal", em: "place" }]
        : [t("reordered space "), space(event)];
    case "space.member.invited":
      return [
        t("invited "),
        person(event.member),
        t(" to space "),
        space(event.space),
        ...(event.role && event.role !== "member" ? [t(` as ${roleWords(event.role)}`)] : []),
      ];
    case "space.member.joined":
      return [
        t("accepted invite to space "),
        space(event.space),
        ...(event.role && event.role !== "member" ? [t(` as ${roleWords(event.role)}`)] : []),
      ];
    case "space.member.declined":
      return [t("declined invite to space "), space(event.space)];
    case "space.member.removed": {
      const what: Part[] =
        event.how === "left"
          ? [t("left space "), space(event.space)]
          : event.how === "revoked"
            ? [t("revoked space invite for "), person(event.member), t(" to "), space(event.space)]
            : [t("removed "), person(event.member), t(" from space "), space(event.space)];
      return [...what, ...lostText(event.lost)];
    }
    case "space.member.role":
      return [
        t("made "),
        person(event.member),
        t(` ${roleWords(event.role)} of space `),
        space(event.space),
        ...lostText(event.lost),
      ];
    case "item.pr.linked":
      return [t("linked PR "), { text: event.prUrl, em: "item" }, t(" to "), item(event)];
    case "item.pr.unlinked":
      return [t("unlinked PR "), { text: event.prUrl, em: "item" }, t(" from "), item(event)];
    case "item.moved": {
      const what = event.with ? [item(event), t(" with "), item(event.with)] : [item(event)];
      const other: Part = { text: event.other.name, em: "place", quote: true };
      const { from, to } = event.refs;
      const notes: Part[] = [
        ...(event.subItems ? [t(`, with ${event.subItems} sub-items`)] : []),
        ...(event.droppedLabels?.length
          ? [t(`, dropped labels ${event.droppedLabels.join(", ")}`)]
          : []),
        ...(event.unassigned?.length ? [t(", unassigned "), ...people(names, event.unassigned)] : []),
      ];
      return event.side === "out"
        ? [t("moved "), ...what, t(` (${from}) to `), other, t(` as ${to}`), ...notes]
        : [t("moved "), ...what, t(" in from "), other, t(` (${from} → ${to})`), ...notes];
    }
    case "agent.started":
      return [
        t("started work on "),
        item(event),
        ...(event.assigned ? [t(", assigned to "), person(event.assigned)] : []),
      ];
    case "agent.resumed":
      return [t("resumed work on "), item(event)];
    case "agent.reported":
      return [t("reported on "), item(event), t(`: ${event.note}`)];
    case "agent.finished":
      return [t("finished work on "), item(event), ...(event.note ? [t(`: ${event.note}`)] : [])];
    case "agent.requested":
      return [t("asked "), agent(event.agent), t(" to work on "), item(event)];
    case "agent.ended":
      return [
        t("ended "),
        agent(event.agent),
        t("'s work on "),
        item(event),
        ...(event.reason ? [t(`: ${event.reason}`)] : []),
      ];
    case "agent.stopped":
      return [
        t("stopped "),
        agent(event.agent),
        t(" on "),
        item(event),
        ...(event.reason ? [t(`: ${event.reason}`)] : []),
      ];
    case "api_key.created":
    case "api_key.revoked":
      return [
        t(event.type === "api_key.created" ? "minted API key " : "revoked API key "),
        key(event.name),
        t(` (${event.prefix}…)`),
      ];
    case "api_key.webhook.set":
      return event.replaced
        ? [t("changed where API key "), key(event.name), t(" starts work, with a new secret")]
        : [t("set API key "), key(event.name), t(" to start work when assigned")];
    case "api_key.webhook.removed":
      return [t("stopped API key "), key(event.name), t(" starting work when assigned")];
    case "github.secret.added":
      return event.first
        ? [t("set up the GitHub webhook with secret "), key(event.name)]
        : [t("added secret "), key(event.name), t(" to the GitHub webhook")];
    case "github.secret.removed":
      return [t("removed secret "), key(event.name), t(" from the GitHub webhook")];
    case "github.webhook.removed":
      return [t("removed the GitHub webhook")];
    case "calendar.connected":
      return [t("connected the iCloud calendars of "), key(event.username)];
    case "calendar.disconnected":
      return [t("disconnected the iCloud calendars of "), key(event.username)];
    case "calendar.reconnected":
      return [t("signed in again to the iCloud calendars of "), key(event.username)];
    case "calendar.included":
      return event.included
        ? [t("included calendar "), key(event.name), t(" in Sidetrack")]
        : [t("left calendar "), key(event.name), t(" out of Sidetrack")];
    case "email.address.created":
      return event.replaced
        ? [t("replaced the email forwarding address")]
        : [t("set up an email forwarding address")];
    case "email.address.removed":
      return [t("turned off email forwarding")];
    case "profile.username":
      return [
        t("changed username from "),
        { text: `@${event.from}`, em: "person" },
        t(" to "),
        { text: `@${event.to}`, em: "person" },
      ];
    case "profile.avatar":
      return [
        t(
          !event.image
            ? "removed avatar"
            : event.uploaded
              ? "uploaded an avatar"
              : `changed avatar to ${event.image}`,
        ),
      ];
    case "profile.installed":
      return [t(event.platform === "phone" ? "added Sidetrack to a phone's Home Screen" : "installed Sidetrack on a computer")];
    case "profile.password":
      return [t(event.viaReset ? "reset password with an emailed link" : "changed password")];
    case "profile.two_factor":
      return [t(event.enabled ? "turned on two-factor sign-in" : "turned off two-factor sign-in")];
    case "profile.backup_codes":
      return [t(event.used ? "used a backup code" : "generated new backup codes")];
  }
}
