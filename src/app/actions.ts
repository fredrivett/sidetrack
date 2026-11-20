"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { appBaseUrl } from "./site";
import {
  createApiKey as createApiKeyCore,
  revokeApiKey as revokeApiKeyCore,
} from "@/core/api-keys";
import {
  removeAgentWebhook as removeAgentWebhookCore,
  setAgentWebhook as setAgentWebhookCore,
} from "@/core/agentWebhooks";
import {
  endAgentSession as endAgentSessionCore,
  requestWork as requestWorkCore,
  stopRequest as stopRequestCore,
} from "@/core/agentSessions";
import { listAudit as listAuditCore } from "@/core/audit";
import {
  addGithubWebhookSecret as addGithubWebhookSecretCore,
  removeGithubWebhook as removeGithubWebhookCore,
  removeGithubWebhookSecret as removeGithubWebhookSecretCore,
} from "@/core/github";
import {
  type LabelEmoji,
  addLabel as addLabelCore,
  deleteLabel as deleteLabelCore,
  listLabelUsage as listLabelUsageCore,
  listLabels as listLabelsCore,
  updateLabel as updateLabelCore,
} from "@/core/labels";
import {
  autoNewListIcon,
  withAutoLabelEmoji,
  withAutoLabelRename,
  withAutoListIcon,
} from "@/core/autoEmoji";
import { itemPriorities as itemPrioritiesCore } from "@/core/autoPriority";
import {
  addComment as addCommentCore,
  deleteComment as deleteCommentCore,
  getComment as getCommentCore,
  listComments as listCommentsCore,
  listRecentComments as listRecentCommentsCore,
  mentionNotice as mentionNoticeCore,
  updateComment as updateCommentCore,
} from "@/core/comments";
import { getDb } from "@/core/db";
import {
  addFeedbackFollowUp as addFeedbackFollowUpCore,
  submitFeedback as submitFeedbackCore,
} from "@/core/feedback";
import type { FeedbackArea, FeedbackKind, FeedbackRating } from "@/lib/feedback";
import {
  addItem as addItemCore,
  completeItem as completeItemCore,
  deleteItem as deleteItemCore,
  getItem as getItemCore,
  getItemWithSubItems as getItemWithSubItemsCore,
  type ItemSort,
  listDoneBefore as listDoneBeforeCore,
  reorderItem as reorderItemCore,
  setItemOrder as setItemOrderCore,
  setItemParent as setItemParentCore,
  setItemsCollapsed as setItemsCollapsedCore,
  sortItems as sortItemsCore,
  uncompleteItem as uncompleteItemCore,
  updateItem as updateItemCore,
} from "@/core/items";
import {
  type MissingLabelChoice,
  moveItem as moveItemCore,
  previewMoveItem as previewMoveItemCore,
} from "@/core/move";
import {
  acceptInvite as acceptInviteCore,
  declineInvite as declineInviteCore,
  inviteMember as inviteMemberCore,
  setMemberRole as setMemberRoleCore,
  listMembers as listMembersCore,
  listSuggestedCollaborators as listSuggestedCollaboratorsCore,
  removeMember as removeMemberCore,
} from "@/core/members";
import {
  createProject as createProjectCore,
  deleteProject as deleteProjectCore,
  getProject as getProjectCore,
  reorderProject as reorderProjectCore,
  updateProject as updateProjectCore,
} from "@/core/projects";
import {
  markNotificationsRead as markNotificationsReadCore,
  setNotificationLevel as setNotificationLevelCore,
} from "@/core/notifications";
import { setFollowing as setFollowingCore } from "@/core/follows";
import {
  type PushSubscriptionInput,
  forgetPushSubscriptions as forgetPushSubscriptionsCore,
  pushTargets as pushTargetsCore,
  removePushSubscription as removePushSubscriptionCore,
  savePushSubscription as savePushSubscriptionCore,
} from "@/core/push";
import type { AuditSource, ListRole, NotificationLevel, ProjectStatus, SpaceColor, SpaceRole } from "@/core/schema";
import {
  acceptSpaceInvite as acceptSpaceInviteCore,
  createSpace as createSpaceCore,
  declineSpaceInvite as declineSpaceInviteCore,
  deleteSpace as deleteSpaceCore,
  inviteSpaceMember as inviteSpaceMemberCore,
  listSpaceMembers as listSpaceMembersCore,
  listSpaces as listSpacesCore,
  listSuggestedSpaceMembers as listSuggestedSpaceMembersCore,
  removeSpaceMember as removeSpaceMemberCore,
  reorderSpace as reorderSpaceCore,
  setProjectSpace as setProjectSpaceCore,
  setSpaceMemberRole as setSpaceMemberRoleCore,
  updateSpace as updateSpaceCore,
} from "@/core/spaces";
import {
  AVATAR_MAX_BYTES,
  setOverdueCollapsed as setOverdueCollapsedCore,
  setNoDateCollapsed as setNoDateCollapsedCore,
  setNoDateListFolded as setNoDateListFoldedCore,
  setAgendaReadAt as setAgendaReadAtCore,
  setBoardFilters as setBoardFiltersCore,
  setGreetingPrefs as setGreetingPrefsCore,
  setTimeZone as setTimeZoneCore,
  getTimeZone as getTimeZoneCore,
  setAvatarUrl as setAvatarUrlCore,
  setUploadedAvatar as setUploadedAvatarCore,
  setUsername as setUsernameCore,
} from "@/core/users";
import { setDayNote as setDayNoteCore } from "@/core/dayNotes";
import { getCurrentSession, requireUserId } from "@/auth/session";
import { sendAgentRequest } from "@/lib/agentRequest";
import { notifyInvite, notifyMentions } from "@/lib/email";
import { getEnv } from "@/lib/env";
import type { ItemFilters } from "@/lib/filters";
import type { GreetingPrefs } from "@/lib/greetingPrefs";
import { sendPush } from "@/lib/push";
import type { Repeat } from "@/lib/repeat";
import { dayOf } from "@/lib/time";

const SOURCE: AuditSource = "web";

function refresh() {
  revalidatePath("/");
}

export async function createProjectAction(input: {
  name: string;
  summary?: string;
  homepageUrl?: string | null;
  icon?: string | null;
  iconChosen?: boolean;
  spaceId?: string | null;
}) {
  const userId = await requireUserId();
  const { db } = getDb();
  // Pick the fields, so a crafted call can't pass others (e.g. status).
  const { name, summary, homepageUrl, iconChosen, spaceId } = input;
  let icon = input.icon;
  // Jev hadn't answered when the form was sent: ask now.
  if (iconChosen === false && !icon) {
    icon = await autoNewListIcon({ name, summary, homepageUrl });
  }
  const p = createProjectCore(
    db,
    userId,
    { name, summary, homepageUrl, icon, iconChosen, spaceId },
    SOURCE,
  );
  refresh();
  return p;
}

export async function updateProjectAction(
  id: string,
  patch: {
    name?: string;
    status?: ProjectStatus;
    summary?: string;
    prefix?: string;
    homepageUrl?: string | null;
    repository?: string | null;
    icon?: string | null;
    iconChosen?: boolean;
    doneClearedAt?: number | null;
  },
) {
  const userId = await requireUserId();
  const { db } = getDb();
  const p = updateProjectCore(
    db,
    userId,
    id,
    await withAutoListIcon(db, userId, id, patch),
    SOURCE,
  );
  refresh();
  return p;
}

/**
 * Move the list's done items into Done now rather than when the day turns
 * over. Stamped with the server's clock, which also stamps completedAt.
 * Returns the previous value, for undo through updateProjectAction.
 */
export async function clearDoneItemsAction(id: string) {
  const userId = await requireUserId();
  const { db } = getDb();
  const previous = getProjectCore(db, userId, id)?.doneClearedAt ?? null;
  updateProjectCore(db, userId, id, { doneClearedAt: Date.now() }, SOURCE);
  refresh();
  return previous;
}

/** Move a list into a Space, to another, or out of its Space (null). */
export async function setProjectSpaceAction(projectId: string, spaceId: string | null) {
  const userId = await requireUserId();
  const { db } = getDb();
  setProjectSpaceCore(db, userId, projectId, spaceId, SOURCE);
  refresh();
}

export async function reorderProjectAction(id: string, ref: string) {
  const userId = await requireUserId();
  const { db } = getDb();
  const p = reorderProjectCore(db, userId, id, ref, SOURCE);
  refresh();
  return p;
}

export async function deleteProjectAction(id: string) {
  const userId = await requireUserId();
  const { db } = getDb();
  deleteProjectCore(db, userId, id, SOURCE);
  refresh();
}

export async function listMembersAction(projectId: string) {
  const userId = await requireUserId();
  const { db } = getDb();
  return listMembersCore(db, userId, projectId);
}

export async function listSuggestedCollaboratorsAction(projectId: string) {
  const userId = await requireUserId();
  const { db } = getDb();
  return listSuggestedCollaboratorsCore(db, userId, projectId);
}

export async function inviteMemberAction(projectId: string, person: string, role: ListRole = "editor") {
  const session = await getCurrentSession();
  if (!session) redirect("/login");
  const userId = session.user.id;
  const { db } = getDb();
  const member = inviteMemberCore(db, userId, projectId, person, SOURCE, role);

  // Notify the invitee by email, once the invite has answered: it's
  // best-effort (the in-app banner is the source of truth, so notifyInvite
  // never throws), and a slow mail server mustn't hold up the page's saves.
  const project = getProjectCore(db, userId, projectId);
  if (member.email && project) {
    const invite = {
      to: member.email,
      inviterName: session.user.name,
      projectName: project.name,
      url: await appBaseUrl(),
    };
    after(() => notifyInvite(invite));
  }

  refresh();
  return member;
}

/** Change what a member of the list can do on it: edit, comment or only view. */
export async function setMemberRoleAction(projectId: string, targetUserId: string, role: ListRole) {
  const userId = await requireUserId();
  const { db } = getDb();
  setMemberRoleCore(db, userId, projectId, targetUserId, role, SOURCE);
  refresh();
}

export async function removeMemberAction(projectId: string, targetUserId: string) {
  const userId = await requireUserId();
  const { db } = getDb();
  removeMemberCore(db, userId, projectId, targetUserId, SOURCE);
  refresh();
}

export async function createSpaceAction(input: {
  name: string;
  icon?: string | null;
  color?: SpaceColor | null;
}) {
  const userId = await requireUserId();
  const { db } = getDb();
  const space = createSpaceCore(
    db,
    userId,
    { name: input.name, icon: input.icon, color: input.color },
    SOURCE,
  );
  refresh();
  return space;
}

export async function updateSpaceAction(
  spaceId: string,
  patch: { name?: string; icon?: string | null; color?: SpaceColor | null },
) {
  const userId = await requireUserId();
  const { db } = getDb();
  updateSpaceCore(
    db,
    userId,
    spaceId,
    { name: patch.name, icon: patch.icon, color: patch.color },
    SOURCE,
  );
  refresh();
}

/** Move a tray (a Space, or "personal") on the caller's board: start | end |
 * after:<id> | before:<id>. */
export async function reorderSpaceAction(trayId: string, ref: string) {
  const userId = await requireUserId();
  const { db } = getDb();
  reorderSpaceCore(db, userId, trayId, ref, SOURCE);
  refresh();
}

export async function deleteSpaceAction(spaceId: string) {
  const userId = await requireUserId();
  const { db } = getDb();
  deleteSpaceCore(db, userId, spaceId, SOURCE);
  refresh();
}

export async function listSpaceMembersAction(spaceId: string) {
  const userId = await requireUserId();
  const { db } = getDb();
  return listSpaceMembersCore(db, userId, spaceId);
}

export async function listSuggestedSpaceMembersAction(spaceId: string) {
  const userId = await requireUserId();
  const { db } = getDb();
  return listSuggestedSpaceMembersCore(db, userId, spaceId);
}

export async function inviteSpaceMemberAction(
  spaceId: string,
  person: string,
  role: Exclude<SpaceRole, "admin"> = "member",
) {
  const session = await getCurrentSession();
  if (!session) redirect("/login");
  const { db } = getDb();
  const member = inviteSpaceMemberCore(db, session.user.id, spaceId, person, SOURCE, role);
  // Best-effort and after answering, like a list invite.
  const space = listSpacesCore(db, session.user.id).find((s) => s.id === spaceId);
  if (member.email && space) {
    const invite = {
      to: member.email,
      inviterName: session.user.name,
      projectName: space.name,
      url: await appBaseUrl(),
      kind: "space" as const,
    };
    after(() => notifyInvite(invite));
  }
  refresh();
  return member;
}

/** Remove someone from a Space, revoke their invite, or (yourself) leave. */
export async function removeSpaceMemberAction(spaceId: string, targetUserId: string) {
  const userId = await requireUserId();
  const { db } = getDb();
  removeSpaceMemberCore(db, userId, spaceId, targetUserId, SOURCE);
  refresh();
}

export async function setSpaceMemberRoleAction(
  spaceId: string,
  targetUserId: string,
  role: SpaceRole,
) {
  const userId = await requireUserId();
  const { db } = getDb();
  setSpaceMemberRoleCore(db, userId, spaceId, targetUserId, role, SOURCE);
  refresh();
}

export async function acceptSpaceInviteAction(spaceId: string) {
  const userId = await requireUserId();
  const { db } = getDb();
  acceptSpaceInviteCore(db, userId, spaceId, SOURCE);
  refresh();
}

export async function declineSpaceInviteAction(spaceId: string) {
  const userId = await requireUserId();
  const { db } = getDb();
  declineSpaceInviteCore(db, userId, spaceId, SOURCE);
  refresh();
}

export async function acceptInviteAction(projectId: string) {
  const userId = await requireUserId();
  const { db } = getDb();
  acceptInviteCore(db, userId, projectId, SOURCE);
  refresh();
}

export async function declineInviteAction(projectId: string) {
  const userId = await requireUserId();
  const { db } = getDb();
  declineInviteCore(db, userId, projectId, SOURCE);
  refresh();
}

/** Leave a project you were invited to (remove your own membership). */
export async function leaveProjectAction(projectId: string) {
  const userId = await requireUserId();
  const { db } = getDb();
  removeMemberCore(db, userId, projectId, userId, SOURCE);
  refresh();
}

/** Files feedback in the deployment's feedback list; returns its id and ref. */
export async function sendFeedbackAction(input: {
  kind: FeedbackKind;
  message: string;
  page?: string | null;
  release?: string | null;
  replayUrl?: string | null;
  personUrl?: string | null;
  about?: { area: FeedbackArea; rating: FeedbackRating; context: string } | null;
}): Promise<{ itemId: string; ref: string }> {
  const userId = await requireUserId();
  const listId = getEnv().FEEDBACK_LIST_ID;
  if (!listId) throw new Error("feedback isn't set up here");
  const { db } = getDb();
  const sent = submitFeedbackCore(db, userId, { ...input, listId }, SOURCE);
  refresh();
  return sent;
}

/** Adds the user's answers to follow-up questions to feedback they just sent. */
export async function addFeedbackFollowUpAction(input: {
  itemId: string;
  answers: Array<{ question: string; answer: string }>;
  note?: string;
}) {
  const userId = await requireUserId();
  const listId = getEnv().FEEDBACK_LIST_ID;
  if (!listId) throw new Error("feedback isn't set up here");
  const { db } = getDb();
  addFeedbackFollowUpCore(db, userId, { ...input, listId }, SOURCE);
  refresh();
}

export async function addItemAction(input: {
  projectId: string;
  title: string;
  description?: string | null;
  labels?: string[];
  labelEmoji?: Record<string, LabelEmoji>;
  positionRef?: string;
  parentId?: string | null;
  dueDate?: string | null;
  dueFrom?: string | null;
  assigneeIds?: string[];
  repeat?: Repeat | null;
  subItems?: string[];
}) {
  const userId = await requireUserId();
  const { db } = getDb();
  const labelEmoji = await withAutoLabelEmoji(
    db,
    userId,
    input.projectId,
    input.labels,
    input.labelEmoji,
  );
  const it = addItemCore(db, userId, { ...input, labelEmoji }, SOURCE);
  refresh();
  return it;
}

export async function updateItemAction(
  id: string,
  patch: {
    title?: string;
    description?: string | null;
    labels?: string[];
    labelEmoji?: Record<string, LabelEmoji>;
    assigneeIds?: string[];
    addAssigneeIds?: string[];
    removeAssigneeIds?: string[];
    dueDate?: string | null;
    dueFrom?: string | null;
    repeat?: Repeat | null;
  },
) {
  const userId = await requireUserId();
  const { db } = getDb();
  const projectId = patch.labels && getItemCore(db, userId, id)?.projectId;
  const labelEmoji = projectId
    ? await withAutoLabelEmoji(db, userId, projectId, patch.labels, patch.labelEmoji)
    : patch.labelEmoji;
  const it = updateItemCore(db, userId, id, { ...patch, labelEmoji }, SOURCE);
  refresh();
  return it;
}

export async function completeItemAction(id: string) {
  const userId = await requireUserId();
  const { db } = getDb();
  const it = completeItemCore(db, userId, id, SOURCE);
  refresh();
  return it;
}

export async function uncompleteItemAction(id: string) {
  const userId = await requireUserId();
  const { db } = getDb();
  const it = uncompleteItemCore(db, userId, id, SOURCE);
  refresh();
  return it;
}

export async function listDoneBeforeAction(opts: {
  before: number;
  limit: number;
  query?: string;
}) {
  const userId = await requireUserId();
  const { db } = getDb();
  const { before, limit, query } = opts;
  return listDoneBeforeCore(db, userId, { before, limit, query });
}

/** An item the viewer can open, with its sub-items, to show one not on their board. */
export async function getItemWithSubItemsAction(id: string) {
  const userId = await requireUserId();
  const { db } = getDb();
  return getItemWithSubItemsCore(db, userId, String(id));
}

export async function reorderItemAction(id: string, ref: string) {
  const userId = await requireUserId();
  const { db } = getDb();
  const it = reorderItemCore(db, userId, id, ref, SOURCE);
  refresh();
  return it;
}

export async function setItemsCollapsedAction(ids: string[], collapsed: boolean) {
  const userId = await requireUserId();
  const { db } = getDb();
  setItemsCollapsedCore(db, userId, ids, collapsed);
  refresh();
}

// The order from before the sort, null when it was already sorted, or false
// when Jev couldn't rank the items for a priority sort (AI off or failed).
export async function sortItemsAction(projectId: string, by: ItemSort) {
  const userId = await requireUserId();
  const { db } = getDb();
  const priority = by === "priority" ? await itemPrioritiesCore(db, userId, projectId) : undefined;
  if (priority === null) return false;
  const previous = sortItemsCore(db, userId, projectId, by, SOURCE, priority);
  refresh();
  return previous;
}

export async function setItemOrderAction(projectId: string, ids: string[]) {
  const userId = await requireUserId();
  const { db } = getDb();
  setItemOrderCore(db, userId, projectId, ids, SOURCE);
  refresh();
}

export async function setItemParentAction(
  id: string,
  parentId: string | null,
  position?: string,
) {
  const userId = await requireUserId();
  const { db } = getDb();
  const it = setItemParentCore(db, userId, id, parentId, SOURCE, position);
  refresh();
  return it;
}

export async function previewMoveItemAction(id: string, projectId: string) {
  const userId = await requireUserId();
  const { db } = getDb();
  return previewMoveItemCore(db, userId, id, projectId);
}

/**
 * Move an item to another list as its preview (`token`) showed. If the move
 * has changed since, nothing moves and this returns the new preview to show
 * instead, since a thrown error's message doesn't reach the browser.
 */
export async function moveItemAction(
  id: string,
  projectId: string,
  token: string,
  labelChoice?: MissingLabelChoice,
  /** Where among the list's top-level items: top (default), end, after:<id> or before:<id>. */
  position?: string,
) {
  const userId = await requireUserId();
  const { db } = getDb();
  const now = previewMoveItemCore(db, userId, id, projectId);
  if (now.token !== token) return { moved: false as const, plan: now };
  // The browser only shows what moved; it reads the item back on refresh.
  const { from, to, refs, matchedLabels, missingLabels, unassigned } = moveItemCore(
    db,
    userId,
    id,
    { projectId, token, missingLabels: labelChoice, position },
    SOURCE,
  );
  refresh();
  return {
    moved: true as const,
    plan: { from, to, refs, matchedLabels, missingLabels, unassigned, token },
  };
}

export async function deleteItemAction(id: string) {
  const userId = await requireUserId();
  const { db } = getDb();
  deleteItemCore(db, userId, id, SOURCE);
  refresh();
}

export async function listCommentsAction(itemId: string) {
  const userId = await requireUserId();
  const { db } = getDb();
  return listCommentsCore(db, userId, itemId);
}

export async function listRecentCommentsAction(opts: {
  projectId?: string;
  limit?: number;
} = {}) {
  const userId = await requireUserId();
  const { db } = getDb();
  return listRecentCommentsCore(db, userId, opts);
}

export async function addCommentAction(itemId: string, body: string) {
  const userId = await requireUserId();
  const { db } = getDb();
  const comment = addCommentCore(db, userId, itemId, body, SOURCE);
  const notice = mentionNoticeCore(db, userId, comment);
  // Emailed once the comment has answered: best-effort (notifyMentions never
  // throws), and a slow mail server mustn't hold up the page's saves.
  if (notice) {
    const url = await appBaseUrl();
    after(() => notifyMentions(notice, url));
  }
  refresh();
  return comment;
}

export async function updateCommentAction(id: string, body: string) {
  const userId = await requireUserId();
  const { db } = getDb();
  const before = getCommentCore(db, userId, id)?.body;
  const comment = updateCommentCore(db, userId, id, body, SOURCE);
  // Only the people the edit newly mentions hear about it.
  const notice = mentionNoticeCore(db, userId, comment, before);
  if (notice) {
    const url = await appBaseUrl();
    after(() => notifyMentions(notice, url));
  }
  refresh();
  return comment;
}

export async function deleteCommentAction(id: string) {
  const userId = await requireUserId();
  const { db } = getDb();
  deleteCommentCore(db, userId, id, SOURCE);
  refresh();
}

/** Fold away or show the Agenda's No date section, for the signed-in user. */
export async function setNoDateCollapsedAction(collapsed: boolean) {
  const userId = await requireUserId();
  const { db } = getDb();
  setNoDateCollapsedCore(db, userId, collapsed);
  refresh();
}

/** Fold away or show one list's card in the Agenda's No date section, for the signed-in user. */
export async function setNoDateListFoldedAction(projectId: string, folded: boolean) {
  const userId = await requireUserId();
  const { db } = getDb();
  setNoDateListFoldedCore(db, userId, projectId, folded);
  refresh();
}

/** Fold away or show the Agenda's Overdue section, for the signed-in user. */
export async function setOverdueCollapsedAction(collapsed: boolean) {
  const userId = await requireUserId();
  const { db } = getDb();
  setOverdueCollapsedCore(db, userId, collapsed);
  refresh();
}

/**
 * The signed-in user has read the Agenda's greeting, so the next looks back
 * from now. No refresh: the greeting they're looking at stays as it is.
 */
export async function setAgendaReadAction() {
  const userId = await requireUserId();
  const { db } = getDb();
  setAgendaReadAtCore(db, userId, Date.now());
}

/**
 * The signed-in user's note for today, in their time zone; "" removes it.
 * Returns it as kept. No refresh: only their greeting reads it, and it asks again.
 */
export async function setDayNoteAction(text: string) {
  const userId = await requireUserId();
  const { db } = getDb();
  const timeZone = getTimeZoneCore(db, userId);
  if (!timeZone) throw new Error("time zone not known yet");
  return setDayNoteCore(db, userId, dayOf(Date.now(), timeZone), String(text));
}

/** Save the browser's timezone for agents' "today". No refresh: nothing shown changes. */
export async function setTimeZoneAction(timeZone: string) {
  const userId = await requireUserId();
  const { db } = getDb();
  setTimeZoneCore(db, userId, timeZone);
}

export async function setBoardFiltersAction(filters: ItemFilters) {
  const userId = await requireUserId();
  const { db } = getDb();
  setBoardFiltersCore(db, userId, filters);
  // So a board the router kept (back from Settings) opens with them too.
  refresh();
}

/** How the viewer likes their Agenda greeting; it applies from their next one. */
export async function setGreetingPrefsAction(prefs: GreetingPrefs) {
  const userId = await requireUserId();
  const { db } = getDb();
  return setGreetingPrefsCore(db, userId, prefs);
}

/** Upload an avatar image (already shrunk by the browser) for the signed-in user. */
export async function uploadAvatarAction(formData: FormData) {
  const userId = await requireUserId();
  const file = formData.get("file");
  if (!(file instanceof File)) throw new Error("no avatar file");
  // Refuse an oversized file before reading it; setUploadedAvatar checks too.
  if (file.size > AVATAR_MAX_BYTES) throw new Error("avatar file is too large");
  const { db } = getDb();
  setUploadedAvatarCore(db, userId, new Uint8Array(await file.arrayBuffer()), SOURCE);
  refresh();
}

/**
 * Change the signed-in user's username, keeping the casing they typed.
 * Returns the reason it was refused ("taken", "reserved", …): production
 * builds hide a thrown Server Action's message, and these are expected.
 */
export async function setUsernameAction(
  username: string,
): Promise<{ error: string } | undefined> {
  const userId = await requireUserId();
  const { db } = getDb();
  try {
    setUsernameCore(db, userId, username, SOURCE);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Couldn't update username." };
  }
  refresh();
}

/** Set the signed-in user's avatar to an image URL, or clear it with null. */
export async function setAvatarUrlAction(url: string | null) {
  const userId = await requireUserId();
  const { db } = getDb();
  setAvatarUrlCore(db, userId, url, SOURCE);
  refresh();
}

export async function addLabelAction(
  projectId: string,
  input: { name: string; emoji?: string | null; emojiChosen?: boolean },
) {
  const userId = await requireUserId();
  const { db } = getDb();
  const l = addLabelCore(db, userId, projectId, input, SOURCE);
  refresh();
  return l;
}

export async function updateLabelAction(
  id: string,
  patch: { name?: string; emoji?: string | null; emojiChosen?: boolean; archived?: boolean },
) {
  const userId = await requireUserId();
  const { db } = getDb();
  const l = updateLabelCore(
    db,
    userId,
    id,
    await withAutoLabelRename(db, userId, id, patch),
    SOURCE,
  );
  refresh();
  return l;
}

/** `token` is from the label's usage, as listLabelUsageAction gave it. */
export async function deleteLabelAction(id: string, token: string) {
  const userId = await requireUserId();
  const { db } = getDb();
  deleteLabelCore(db, userId, id, token, SOURCE);
  refresh();
}

export async function listLabelUsageAction(projectId: string) {
  const userId = await requireUserId();
  const { db } = getDb();
  return listLabelUsageCore(db, userId, projectId);
}

export async function listLabelsAction(projectId: string) {
  const userId = await requireUserId();
  const { db } = getDb();
  return listLabelsCore(db, userId, projectId);
}

export async function listAuditAction(opts: {
  projectId?: string;
  itemId?: string;
  source?: AuditSource;
  limit?: number;
} = {}) {
  const userId = await requireUserId();
  const { db } = getDb();
  return listAuditCore(db, userId, opts);
}

export async function createApiKeyAction(name: string) {
  const userId = await requireUserId();
  const { db } = getDb();
  const { record, plaintext } = createApiKeyCore(db, userId, name, SOURCE);
  revalidatePath("/settings/keys");
  // plaintext is returned to the caller exactly once, then never persisted.
  return { record, plaintext };
}

export async function addGithubWebhookSecretAction(name: string) {
  const userId = await requireUserId();
  const { db } = getDb();
  const { id, secret } = addGithubWebhookSecretCore(db, userId, name, SOURCE);
  revalidatePath("/settings/github");
  // The secret is shown once, to paste into GitHub.
  return { id, secret };
}

export async function removeGithubWebhookSecretAction(id: string) {
  const userId = await requireUserId();
  const { db } = getDb();
  removeGithubWebhookSecretCore(db, userId, id, SOURCE);
  revalidatePath("/settings/github");
}

export async function removeGithubWebhookAction() {
  const userId = await requireUserId();
  const { db } = getDb();
  removeGithubWebhookCore(db, userId, SOURCE);
  revalidatePath("/settings/github");
}

export async function revokeApiKeyAction(id: string) {
  const userId = await requireUserId();
  const { db } = getDb();
  const removed = revokeApiKeyCore(db, userId, id, SOURCE);
  revalidatePath("/settings/keys");
  return { removed };
}

export async function setAgentWebhookAction(keyId: string, url: string) {
  const userId = await requireUserId();
  const { db } = getDb();
  const { secret } = setAgentWebhookCore(db, userId, keyId, url, SOURCE);
  revalidatePath("/settings/keys");
  // The signing secret is shown once, to give to whatever receives the webhook.
  return { secret };
}

export async function removeAgentWebhookAction(keyId: string) {
  const userId = await requireUserId();
  const { db } = getDb();
  removeAgentWebhookCore(db, userId, keyId, SOURCE);
  revalidatePath("/settings/keys");
}

/** Follow or unfollow an item, to hear its activity. */
export async function setFollowingAction(itemId: string, following: boolean) {
  const userId = await requireUserId();
  const { db } = getDb();
  setFollowingCore(db, userId, itemId, following);
  refresh();
}

/**
 * Set how much the viewer hears about a scope ("all", "space:<id>" or
 * "list:<id>"); null goes back to what it inherits.
 */
export async function setNotificationLevelAction(scope: string, level: NotificationLevel | null) {
  const userId = await requireUserId();
  const { db } = getDb();
  setNotificationLevelCore(db, userId, String(scope), level);
  refresh();
}

/** Mark the viewer's notifications `ids` seen, or all of them. */
export async function markNotificationsReadAction(ids?: string[]) {
  const userId = await requireUserId();
  const { db } = getDb();
  markNotificationsReadCore(db, userId, ids);
  refresh();
}

/** The server's VAPID keys; push actions refuse to run without them. */
function requireVapid() {
  const vapid = getEnv().VAPID;
  if (!vapid) throw new Error("push notifications aren't set up on this server");
  return vapid;
}

export async function savePushSubscriptionAction(input: PushSubscriptionInput) {
  const userId = await requireUserId();
  const { db } = getDb();
  const vapid = requireVapid();
  // Pick the fields, so a crafted call can't pass others.
  const { endpoint, keys, deviceLabel } = input;
  savePushSubscriptionCore(
    db,
    userId,
    { endpoint, keys: { p256dh: keys?.p256dh, auth: keys?.auth }, deviceLabel },
    vapid.publicKey,
  );
  revalidatePath("/settings/notifications");
}

export async function removePushSubscriptionAction(endpoint: string) {
  const userId = await requireUserId();
  const { db } = getDb();
  removePushSubscriptionCore(db, userId, endpoint);
  revalidatePath("/settings/notifications");
}

/** Send a notification to each of the user's devices, to check push works. */
export async function sendTestPushAction() {
  const userId = await requireUserId();
  const { db } = getDb();
  const vapid = requireVapid();
  const { sent, gone } = await sendPush(
    pushTargetsCore(db, userId, vapid.publicKey),
    {
      title: "Sidetrack",
      body: "Notifications are on for this device.",
      url: "/settings/notifications",
      tag: "test",
    },
    vapid,
  );
  forgetPushSubscriptionsCore(db, gone);
  if (gone.length) revalidatePath("/settings/notifications");
  return { sent };
}

/**
 * Start one of the viewer's agents on an item (assigning it in the picker).
 * The session opens first, so the board shows the agent at once; if its
 * webhook can't be reached, that session ends again and this throws.
 */
export async function startAgentAction(itemId: string, keyId: string) {
  const userId = await requireUserId();
  const { db } = getDb();
  const { session, request } = requestWorkCore(db, userId, itemId, keyId, SOURCE);
  try {
    if (request) await sendAgentRequest(request);
  } catch (e) {
    endAgentSessionCore(db, userId, session.id, SOURCE, (e as Error).message);
    refresh();
    throw e;
  }
  refresh();
}

/**
 * Stop one of the viewer's agents on an item (unassigning it). The agent is
 * told first and the session ends once it has been, so a stop that couldn't
 * be delivered stays on the board to try again. With no webhook left to
 * tell, it just ends.
 */
export async function stopAgentAction(itemId: string, keyId: string) {
  const userId = await requireUserId();
  const { db } = getDb();
  const found = stopRequestCore(db, userId, itemId, keyId);
  if (!found) return;
  if (found.request) await sendAgentRequest(found.request);
  endAgentSessionCore(db, userId, found.session.id, SOURCE);
  refresh();
}
