import { inArray } from "drizzle-orm";
import { ITEM_SORTS } from "../lib/itemSorts";
import { repeatLabel } from "../lib/repeat";
import { users } from "./auth-schema";
import type { Db } from "./db";
import type { ChangeEvent, DueAt, ItemAt, PersonAt } from "./events";
import { items, projects } from "./schema";

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
}

/**
 * Current names for the things a page of events mentions. An item reads by
 * its current title only while it's still in the list the event happened
 * in: once moved, its new title is for the new list's readers, who may not
 * be this one. Anything gone, or moved, reads as the event stored it.
 */
export interface Names {
  item(it: ItemAt, projectId: string): string;
  person(p: PersonAt): string;
  list(id: string, fallback: string): string;
}

/** Every id an event refers to, by the key that names it. */
function collect(value: unknown, into: { items: Set<string>; people: Set<string>; lists: Set<string> }) {
  if (Array.isArray(value)) {
    for (const v of value) collect(v, into);
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (typeof v === "string") {
        if (k === "itemId") into.items.add(v);
        else if (k === "userId") into.people.add(v);
        else if (k === "projectId") into.lists.add(v);
      } else {
        collect(v, into);
      }
    }
  }
}

/** Current names for `events`, read in one query per kind of thing. */
export function namesFor(db: Db, events: ChangeEvent[]): Names {
  const ids = { items: new Set<string>(), people: new Set<string>(), lists: new Set<string>() };
  collect(events, ids);
  const itemRows = ids.items.size
    ? db
        .select({ id: items.id, title: items.title, projectId: items.projectId })
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
  const itemById = new Map(itemRows.map((r) => [r.id, r]));
  // `@username`, then name, then email.
  const people = new Map(
    userRows.map((u) => [u.id, u.username ? `@${u.username}` : (u.name ?? u.email)]),
  );
  const lists = new Map(listRows.map((r) => [r.id, r.name]));
  return {
    item(it, projectId) {
      const row = itemById.get(it.itemId);
      return row && row.projectId === projectId ? row.title : it.title;
    },
    person: (p) => people.get(p.userId) ?? p.name,
    list: (id, fallback) => lists.get(id) ?? fallback,
  };
}

/** A sentence as plain text, names in quotes: `completed "Fix tap"`. */
export function plainText(parts: Part[]): string {
  return parts.map((p) => (p.quote ? `"${p.text}"` : p.text)).join("");
}

export function dueText(due: DueAt): string {
  return due.dueFrom ? `${due.dueFrom} to ${due.dueDate}` : (due.dueDate ?? "");
}

const t = (text: string): Part => ({ text });

/** Several people, comma-separated, each standing out. */
function people(names: Names, list: PersonAt[]): Part[] {
  return list.flatMap((p, i) => [
    ...(i ? [t(", ")] : []),
    { text: names.person(p), em: "person" as const },
  ]);
}

export function describeEvent(event: ChangeEvent, names: Names): Part[] {
  const item = (it: ItemAt): Part => ({
    text: names.item(it, event.projectId),
    em: "item",
    quote: true,
  });
  switch (event.type) {
    case "item.created": {
      const parts: Part[] = event.parent
        ? [t("added "), item(event), t(" to "), item(event.parent)]
        : [t("added task "), item(event)];
      if (event.due.dueDate) parts.push(t(`, due ${dueText(event.due)}`));
      if (event.labels.length) parts.push(t(`, labelled ${event.labels.join(", ")}`));
      if (event.assignees.length) parts.push(t(", assigned to "), ...people(names, event.assignees));
      if (event.repeat) parts.push(t(`, repeats ${repeatLabel(event.repeat).toLowerCase()}`));
      return parts;
    }
    case "item.updated": {
      const c = event.changes;
      // A rename keeps the name it had, so the row says what it was.
      const subject: Part = c.title
        ? { text: c.title.from, em: "item" }
        : { text: names.item(event, event.projectId), em: "item" };
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
      if (c.due) changes.push([t(c.due.dueDate ? `due ${dueText(c.due)}` : "due date cleared")]);
      if (c.repeat !== undefined) {
        changes.push([
          t(c.repeat ? `repeats ${repeatLabel(c.repeat).toLowerCase()}` : "no longer repeats"),
        ]);
      }
      return [subject, t(": "), ...changes.flatMap((p, i) => (i ? [t(", "), ...p] : p))];
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
      if (event.repeat) parts.push(t(` (repeats ${repeatLabel(event.repeat).toLowerCase()})`));
      if (event.with) parts.push(t(" with "), item(event.with));
      if (event.due) parts.push(t(`, due ${dueText(event.due)}`));
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
      const list: Part = {
        text: names.list(event.projectId, event.listName),
        em: "place",
        quote: true,
      };
      return event.by
        ? [t("sorted "), list, t(` by ${ITEM_SORTS[event.by]}`)]
        : [t("reordered the items in "), list];
    }
  }
}
