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

/** What the role lets someone do with the lists it covers. */
export function roleHint(role: Role): string {
  return role === "viewer"
    ? "Sees the lists and their items, but can't change or comment on them"
    : role === "commenter"
      ? "Sees the lists and comments, but can't change them"
      : role === "admin"
        ? "Changes anything, and manages the Space and its people"
        : "Changes anything on the lists";
}
