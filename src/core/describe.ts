import { eq } from "drizzle-orm";
import { ITEM_SORTS } from "../lib/itemSorts";
import { repeatLabel } from "../lib/repeat";
import { users } from "./auth-schema";
import type { Db } from "./db";
import type { ChangeEvent, DueAt } from "./events";
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

/** Current names, looked up once each per page of rows. */
export interface Names {
  item(id: string, fallback: string): string;
  person(id: string): string;
  list(id: string, fallback: string): string;
}

export function namesFrom(db: Db): Names {
  const itemNames = new Map<string, string | null>();
  const people = new Map<string, string>();
  const lists = new Map<string, string | null>();
  return {
    item(id, fallback) {
      if (!itemNames.has(id)) {
        const row = db.select({ title: items.title }).from(items).where(eq(items.id, id)).get();
        itemNames.set(id, row?.title ?? null);
      }
      return itemNames.get(id) ?? fallback;
    },
    // `@username`, then name, email, then the raw id (a deleted user).
    person(id) {
      let label = people.get(id);
      if (label === undefined) {
        const u = db
          .select({ username: users.username, name: users.name, email: users.email })
          .from(users)
          .where(eq(users.id, id))
          .get();
        label = u?.username ? `@${u.username}` : (u?.name ?? u?.email ?? id);
        people.set(id, label);
      }
      return label;
    },
    list(id, fallback) {
      if (!lists.has(id)) {
        const row = db.select({ name: projects.name }).from(projects).where(eq(projects.id, id)).get();
        lists.set(id, row?.name ?? null);
      }
      return lists.get(id) ?? fallback;
    },
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

/** Several people, \", \"-separated, each standing out. */
function people(names: Names, ids: string[]): Part[] {
  return ids.flatMap((id, i) => [
    ...(i ? [t(", ")] : []),
    { text: names.person(id), em: "person" as const },
  ]);
}

export function describeEvent(event: ChangeEvent, names: Names): Part[] {
  const item = (it: { itemId: string; title: string }): Part => ({
    text: names.item(it.itemId, it.title),
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
        : { text: names.item(event.itemId, event.title), em: "item" };
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
