// What each list and Space role is called, and what it lets someone do, in
// the words the app and its activity use. Framework-agnostic.

import type { ListRole, SpaceRole } from "../core/schema";

type Role = ListRole | SpaceRole;

const NAMES: Record<Role, string> = {
  admin: "Admin",
  member: "Member",
  editor: "Can edit",
  commenter: "Can comment",
  viewer: "Can view",
};

/** "Can view": the role as a choice in a menu. */
export function roleName(role: Role): string {
  return NAMES[role];
}

/** "a viewer": the role as a sentence names it. */
export function roleWords(role: Role): string {
  return role === "admin" || role === "editor" ? `an ${role}` : `a ${role}`;
}

/** What the role lets someone do, on one list or across a Space's lists. */
export function roleHint(role: Role, scope: "list" | "space"): string {
  const its = scope === "list" ? "its items" : "its lists and their items";
  switch (role) {
    case "viewer":
      return `Sees ${its}, but can't change or comment on them`;
    case "commenter":
      return `Sees ${its} and comments on them, but can't change them`;
    case "admin":
      return "Changes anything, and manages the Space and its people";
    case "member":
      return "Changes its lists and their items, and adds lists to it";
    case "editor":
      return "Changes its items and details";
  }
}
