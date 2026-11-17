import type { ItemSort } from "../lib/itemSorts";
import type { Repeat } from "../lib/repeat";
import type { AuditAction, AuditEntity, ProjectStatus, SpaceColor, SpaceRole } from "./schema";

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

/** A Space as it was named when the change happened. */
export interface SpaceAt {
  spaceId: string;
  name: string;
}

/** What losing access to a list cleaned up (members.ts revokeListAccess).
 * Left out when it cleaned up nothing. */
export interface AccessLost {
  unassigned: number;
  ended: number;
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

/** What updateProject changed, in the order it's described. */
export interface ListChanges {
  name?: { from: string; to: string };
  prefix?: { from: string; to: string };
  status?: { from: ProjectStatus; to: ProjectStatus };
  summary?: "edited";
  homepage?: "set" | "edited" | "cleared";
  repository?: { from: string | null; to: string | null };
  /** "chose": the icon it had (Jev's) chosen as is; "chose-none" likewise. */
  icon?: "set" | "changed" | "cleared" | "chose" | "chose-none";
  /** Done items moved to Done, or back to the list (an undo). */
  done?: "cleared" | "restored";
}

/** How someone stopped being a member. */
export type MemberExit = "left" | "revoked" | "removed";

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
      /** Added as one of its parent's lines, in the same go as the parent. */
      withParent?: true;
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
      /** Logged as already done when it was added. */
      added?: true;
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
    }
  // Comments
  | {
      type: "comment.created" | "comment.edited";
      projectId: string;
      commentId: string;
      item: ItemAt;
      /** Who it @mentions: everyone on a new comment, and only those it
       * didn't mention before on an edit. Left out when none. */
      mentioned?: PersonAt[];
    }
  | { type: "comment.deleted"; projectId: string; commentId: string; item: ItemAt }
  // Lists
  | { type: "list.created"; projectId: string; listName: string; space: SpaceAt | null }
  | { type: "list.updated"; projectId: string; listName: string; changes: ListChanges }
  | { type: "list.reordered" | "list.deleted"; projectId: string; listName: string }
  | {
      type: "list.space.changed";
      projectId: string;
      listName: string;
      from: SpaceAt | null;
      to: SpaceAt | null;
      lost?: AccessLost;
    }
  // People on a list
  | {
      type: "member.invited";
      projectId: string;
      listName: string;
      membershipId: string;
      member: PersonAt;
    }
  | {
      type: "member.joined" | "member.declined";
      projectId: string;
      listName: string;
      membershipId: string;
    }
  | {
      type: "member.removed";
      projectId: string;
      listName: string;
      membershipId: string;
      member: PersonAt;
      how: MemberExit;
      lost?: AccessLost;
    }
  // Labels
  | {
      type: "label.created";
      projectId: string;
      labelId: string;
      name: string;
      emoji: string | null;
    }
  | {
      type: "label.updated";
      projectId: string;
      labelId: string;
      /** Its name before this change. */
      name: string;
      changes: {
        name?: { from: string; to: string };
        /** kept: the emoji it had (Jev's), chosen as is. */
        emoji?: { to: string | null; kept?: true };
      };
    }
  // Spaces
  | ({ type: "space.created"; color: SpaceColor | null } & SpaceAt)
  | ({
      type: "space.updated";
      changes: {
        name?: { from: string; to: string };
        /** Null: cleared. */
        icon?: string | null;
        color?: SpaceColor | null;
      };
    } & SpaceAt)
  | ({ type: "space.deleted"; lost?: AccessLost } & SpaceAt)
  /** A Space, or the viewer's Personal tray, moved on their board. */
  | ({ type: "space.reordered" } & SpaceAt)
  // People in a Space
  | { type: "space.member.invited"; space: SpaceAt; membershipId: string; member: PersonAt }
  | { type: "space.member.joined" | "space.member.declined"; space: SpaceAt; membershipId: string }
  | {
      type: "space.member.removed";
      space: SpaceAt;
      membershipId: string;
      member: PersonAt;
      how: MemberExit;
      lost?: AccessLost;
    }
  | {
      type: "space.member.role";
      space: SpaceAt;
      membershipId: string;
      member: PersonAt;
      role: SpaceRole;
    }
  // Pull requests
  | ({ type: "item.pr.linked" | "item.pr.unlinked"; projectId: string; prUrl: string } & ItemAt)
  | ItemMove
  | AgentWork
  | AccountEvent;

/** One row of an item's move, written in each list's history: `out` in the
 * list it left, `in` in the one it joined. */
export type ItemMove = {
  type: "item.moved";
  /** The list whose history this row is in. */
  projectId: string;
  side: "out" | "in";
  /** The item it moved with, when it went as a sub-item of it. */
  with?: ItemAt;
  /** Its parent here, for the row's parentId: null on `in` for the item moved. */
  parentId: string | null;
  /** The other list, by the name it had: its readers may not be this one's. */
  other: { projectId: string; name: string };
  refs: { from: string; to: string };
  /** The item moved, not its sub-items: what came with it. */
  subItems?: number;
  droppedLabels?: string[];
  unassigned?: PersonAt[];
} & ItemAt;

/** An agent's work on an item. */
export type AgentWork =
  | ({ type: "agent.started"; projectId: string; assigned?: PersonAt } & ItemAt)
  | ({ type: "agent.resumed"; projectId: string } & ItemAt)
  | ({ type: "agent.reported"; projectId: string; note: string } & ItemAt)
  | ({ type: "agent.finished"; projectId: string; note: string | null } & ItemAt)
  /** Its owner asked it to start, by assigning it in Sidetrack. */
  | ({ type: "agent.requested"; projectId: string; agent: string } & ItemAt)
  /** Stopped by its owner, or ended for a reason outside the agents. */
  | ({
      type: "agent.stopped" | "agent.ended";
      projectId: string;
      agent: string;
      reason: string | null;
    } & ItemAt);

/** Account-level changes: no list, so only their actor reads them. */
export type AccountEvent =
  | { type: "api_key.created" | "api_key.revoked"; keyId: string; name: string; prefix: string }
  /** `replaced`: a new URL or secret for a key that already had one. */
  | { type: "api_key.webhook.set"; keyId: string; name: string; replaced: boolean }
  | { type: "api_key.webhook.removed"; keyId: string; name: string }
  /** `first`: the secret that set the webhook up. */
  | { type: "github.secret.added"; webhookId: string; secretId: string; name: string; first: boolean }
  | { type: "github.secret.removed"; webhookId: string; secretId: string; name: string }
  | { type: "github.webhook.removed"; webhookId: string }
  | { type: "profile.username"; userId: string; from: string; to: string }
  /** `image` null: cleared. */
  | { type: "profile.avatar"; userId: string; image: string | null; uploaded?: true }
  /** Written by the audit_password_update trigger (migration 0045), not core. */
  | { type: "profile.password"; userId: string; viaReset: boolean };

/** `lost`, or undefined when it cleaned up nothing, to keep it off the event. */
export function accessLost(lost: AccessLost): AccessLost | undefined {
  return lost.unassigned || lost.ended ? lost : undefined;
}

/** The audit row's columns for an event, which its filters and indexes use. */
export function auditColumns(event: ChangeEvent): {
  action: AuditAction;
  entityType: AuditEntity;
  entityId: string;
  projectId: string | null;
  /** Undefined: read it from the item. */
  parentId?: string | null;
} {
  switch (event.type) {
    case "item.created":
      return { action: "create", entityType: "item", entityId: event.itemId, projectId: event.projectId };
    case "item.updated":
      return { action: "update", entityType: "item", entityId: event.itemId, projectId: event.projectId };
    case "item.completed":
      return { action: "complete", entityType: "item", entityId: event.itemId, projectId: event.projectId };
    case "item.reopened":
      return { action: "uncomplete", entityType: "item", entityId: event.itemId, projectId: event.projectId };
    case "item.reordered":
      return { action: "reorder", entityType: "item", entityId: event.itemId, projectId: event.projectId };
    case "item.deleted":
      // Gone by now, so it can't be read back from the row.
      return {
        action: "delete",
        entityType: "item",
        entityId: event.itemId,
        projectId: event.projectId,
        parentId: event.parentId,
      };
    case "item.nested":
      return {
        action: "update",
        entityType: "item",
        entityId: event.itemId,
        projectId: event.projectId,
        parentId: event.parent.itemId,
      };
    case "item.unnested":
      // Moving out belongs to the parent it left.
      return {
        action: "update",
        entityType: "item",
        entityId: event.itemId,
        projectId: event.projectId,
        parentId: event.parent.itemId,
      };
    case "list.items.sorted":
    case "list.reordered":
      return list("reorder", event.projectId);
    case "comment.created":
    case "comment.edited":
    case "comment.deleted":
      return {
        action: event.type === "comment.created" ? "create" : event.type === "comment.edited" ? "update" : "delete",
        entityType: "comment",
        entityId: event.commentId,
        projectId: event.projectId,
        parentId: event.item.itemId,
      };
    case "list.created":
      return list("create", event.projectId);
    case "list.updated":
    case "list.space.changed":
      return list("update", event.projectId);
    case "list.deleted":
      return list("delete", event.projectId);
    case "member.invited":
      return member("create", event.membershipId, event.projectId);
    case "member.joined":
      return member("update", event.membershipId, event.projectId);
    case "member.declined":
    case "member.removed":
      return member("delete", event.membershipId, event.projectId);
    case "label.created":
    case "label.updated":
      return {
        action: event.type === "label.created" ? "create" : "update",
        entityType: "label",
        entityId: event.labelId,
        projectId: event.projectId,
      };
    case "space.created":
      return space("create", event.spaceId);
    case "space.updated":
      return space("update", event.spaceId);
    case "space.deleted":
      return space("delete", event.spaceId);
    case "space.reordered":
      // Personal is logged as a Space-level event too, with its tray id.
      return space("reorder", event.spaceId);
    case "space.member.invited":
      return spaceMember("create", event.membershipId);
    case "space.member.joined":
    case "space.member.role":
      return spaceMember("update", event.membershipId);
    case "space.member.declined":
    case "space.member.removed":
      return spaceMember("delete", event.membershipId);
    case "item.pr.linked":
    case "item.pr.unlinked":
      return {
        action: event.type === "item.pr.linked" ? "link" : "unlink",
        entityType: "item",
        entityId: event.itemId,
        projectId: event.projectId,
      };
    case "item.moved":
      return {
        action: "update",
        entityType: "item",
        entityId: event.itemId,
        projectId: event.projectId,
        parentId: event.parentId,
      };
    case "agent.started":
    case "agent.resumed":
    case "agent.requested":
      return { action: "start", entityType: "item", entityId: event.itemId, projectId: event.projectId };
    case "agent.reported":
      return { action: "report", entityType: "item", entityId: event.itemId, projectId: event.projectId };
    case "agent.finished":
    case "agent.stopped":
    case "agent.ended":
      return { action: "finish", entityType: "item", entityId: event.itemId, projectId: event.projectId };
    case "api_key.created":
      return account("create", "api_key", event.keyId);
    case "api_key.revoked":
      return account("delete", "api_key", event.keyId);
    case "api_key.webhook.set":
      return account(event.replaced ? "update" : "create", "api_key", event.keyId);
    case "api_key.webhook.removed":
      return account("update", "api_key", event.keyId);
    case "github.secret.added":
      return account(event.first ? "create" : "update", "webhook", event.webhookId);
    case "github.secret.removed":
      return account("update", "webhook", event.webhookId);
    case "github.webhook.removed":
      return account("delete", "webhook", event.webhookId);
    case "profile.username":
    case "profile.password":
      return account("update", "profile", event.userId);
    case "profile.avatar":
      return account(event.image ? "update" : "delete", "profile", event.userId);
  }
}

function list(action: AuditAction, projectId: string) {
  return { action, entityType: "project" as const, entityId: projectId, projectId };
}

function member(action: AuditAction, membershipId: string, projectId: string) {
  return { action, entityType: "member" as const, entityId: membershipId, projectId };
}

// Spaces belong to no list, so their rows have none.
function space(action: AuditAction, spaceId: string) {
  return { action, entityType: "space" as const, entityId: spaceId, projectId: null };
}

function account(action: AuditAction, entityType: AuditEntity, entityId: string) {
  return { action, entityType, entityId, projectId: null };
}

function spaceMember(action: AuditAction, membershipId: string) {
  return { action, entityType: "space_member" as const, entityId: membershipId, projectId: null };
}
