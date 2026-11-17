import type { ItemSort } from "../lib/itemSorts";
import type { Repeat } from "../lib/repeat";
import type { AuditAction, AuditEntity } from "./schema";

// Change events: what a change did, as data. The function making a change
// records one with recordAudit, in the change's transaction, and it's stored
// on the audit row. Activity, an item's history and (later) notifications
// read it back through core/describe.ts, which shows current names.
//
// An event holds ids, plus what a rename or delete would make unreadable:
// names at the time, and both sides of a change. Never anything a reader
// can't be shown, such as a secret.

/** An item as it was named when the change happened. */
export interface ItemAt {
  itemId: string;
  title: string;
}

/** A person as they were labelled when the change happened, for once they're gone. */
export interface PersonAt {
  userId: string;
  name: string;
}

export interface DueAt {
  dueDate: string | null;
  dueFrom: string | null;
}

/** What updateItem changed, in the order it's described. */
export interface ItemChanges {
  title?: { from: string; to: string };
  description?: "edited" | "cleared";
  labels?: { added: string[]; removed: string[] };
  assignees?: { added: PersonAt[]; removed: PersonAt[] };
  due?: DueAt;
  repeat?: Repeat | null;
}

export type ChangeEvent =
  | ({
      type: "item.created";
      projectId: string;
      /** The parent it was added under, for a sub-item. */
      parent: ItemAt | null;
      due: DueAt;
      labels: string[];
      assignees: PersonAt[];
      repeat: Repeat | null;
    } & ItemAt)
  | ({ type: "item.updated"; projectId: string; changes: ItemChanges } & ItemAt)
  | ({
      type: "item.completed";
      projectId: string;
      /**
       * The item whose completing did this one: its last open sub-item (it's
       * the parent), or its parent (it's a sub-item ticked with it).
       */
      with?: ItemAt & { as: "last-sub-item" | "parent" };
    } & ItemAt)
  | ({
      type: "item.reopened";
      projectId: string;
      /** Reopened because a sub-item opened under it. */
      forSubItem?: true;
      /** Reopened by its repeat rule, now due again. */
      repeat?: Repeat;
      /** The repeating parent it came round with. */
      with?: ItemAt;
      due?: DueAt;
    } & ItemAt)
  | ({ type: "item.reordered"; projectId: string } & ItemAt)
  | ({
      type: "item.deleted";
      projectId: string;
      parentId: string | null;
      /** The parent it was deleted with. */
      with?: ItemAt;
    } & ItemAt)
  | ({ type: "item.nested"; projectId: string; parent: ItemAt } & ItemAt)
  | ({
      type: "item.unnested";
      projectId: string;
      /** The parent it left; title null when it couldn't be read. */
      parent: { itemId: string; title: string | null };
    } & ItemAt)
  | {
      type: "list.items.sorted";
      projectId: string;
      listName: string;
      /** Null when put back in an earlier order, undoing a sort. */
      by: ItemSort | null;
    };

/** The audit row's columns for an event, which its filters and indexes use. */
export function auditColumns(event: ChangeEvent): {
  action: AuditAction;
  entityType: AuditEntity;
  entityId: string;
  projectId: string;
  /** Undefined: read it from the item. */
  parentId?: string | null;
} {
  const { projectId } = event;
  switch (event.type) {
    case "item.created":
      return { action: "create", entityType: "item", entityId: event.itemId, projectId };
    case "item.updated":
      return { action: "update", entityType: "item", entityId: event.itemId, projectId };
    case "item.completed":
      return { action: "complete", entityType: "item", entityId: event.itemId, projectId };
    case "item.reopened":
      return { action: "uncomplete", entityType: "item", entityId: event.itemId, projectId };
    case "item.reordered":
      return { action: "reorder", entityType: "item", entityId: event.itemId, projectId };
    case "item.deleted":
      // Gone by now, so it can't be read back from the row.
      return {
        action: "delete",
        entityType: "item",
        entityId: event.itemId,
        projectId,
        parentId: event.parentId,
      };
    case "item.nested":
      return {
        action: "update",
        entityType: "item",
        entityId: event.itemId,
        projectId,
        parentId: event.parent.itemId,
      };
    case "item.unnested":
      // Moving out belongs to the parent it left.
      return {
        action: "update",
        entityType: "item",
        entityId: event.itemId,
        projectId,
        parentId: event.parent.itemId,
      };
    case "list.items.sorted":
      return { action: "reorder", entityType: "project", entityId: projectId, projectId };
  }
}
