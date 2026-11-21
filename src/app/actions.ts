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
  listOpenAgentSessions as listOpenAgentSessionsCore,
  requestWork as requestWorkCore,
  stopRequest as stopRequestCore,
} from "@/core/agentSessions";
import { listAudit as listAuditCore } from "@/core/audit";
import {
  calendarConfig,
  CalendarConnectError,
  connectICloud as connectICloudCore,
  disconnectCalendarAccount as disconnectCalendarAccountCore,
  listCalendarAccounts as listCalendarAccountsCore,
  setCalendarIncluded as setCalendarIncludedCore,
  syncCalendarAccount as syncCalendarAccountCore,
} from "@/core/calendars";
import {
  addGithubWebhookSecret as addGithubWebhookSecretCore,
  removeGithubWebhook as removeGithubWebhookCore,
  removeGithubWebhookSecret as removeGithubWebhookSecretCore,
} from "@/core/github";
import {
  createEmailAddress as createEmailAddressCore,
  removeEmailAddress as removeEmailAddressCore,
} from "@/core/emailIn";
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
  listMentionable as listMentionableCore,
  listRecentComments as listRecentCommentsCore,
  mentionNotice as mentionNoticeCore,
  updateComment as updateCommentCore,
} from "@/core/comments";
import { changeSeq } from "@/core/changes";
import { type Db, getDb } from "@/core/db";
import {
  addSmartMatch as addSmartMatchCore,
  findSmartCandidates as findSmartCandidatesCore,
  getSmartDue as getSmartDueCore,
  removeSmartMatch as removeSmartMatchCore,
  setSmartRule as setSmartRuleCore,
} from "@/core/smartDue";
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
  groupIds as groupIdsCore,
  type ItemSort,
  listDoneBefore as listDoneBeforeCore,
  readItems as readItemsCore,
  type Saved,
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
import { followersOf as followersOfCore, setFollowing as setFollowingCore } from "@/core/follows";
import {
  type PushSubscriptionInput,
  forgetPushSubscriptions as forgetPushSubscriptionsCore,
  pushTargets as pushTargetsCore,
  removePushSubscription as removePushSubscriptionCore,
  savePushSubscription as savePushSubscriptionCore,
} from "@/core/push";
import type { AuditSource, ListRole, NotificationLevel, OnlyWithin, ProjectStatus, SpaceColor, SpaceRole } from "@/core/schema";
import { invitePeople as invitePeopleCore, type InvitePlace } from "@/core/invites";
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
import type { GetStartedStep, InstallPlatform } from "@/lib/getStarted";
import {
  recordInstall as recordInstallCore,
  sendGetStartedToBack as sendGetStartedToBackCore,
  setGetStartedCollapsed as setGetStartedCollapsedCore,
} from "@/core/getStarted";
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
import {
  addFromSource as addFromSourceCore,
  discardSource as discardSourceCore,
  getItemSource as getItemSourceCore,
  type LineReview,
} from "@/core/sources";
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

/**
 * The rows of `ids` for the board to put in, instead of reloading it all
 * (useSavedItems), for a save made after change number `from` (read just
 * before it, so the changes after it are the save's own). Says which of them
 * the viewer follows: assigning themselves or adding an item makes them
 * follow it, which no row shows.
 */
function savedRows(db: Db, userId: string, from: number, ids: string[]): Saved {
  const saved = readItemsCore(db, userId, ids);
  const followed = saved.items.flatMap((i) => (followersOfCore(db, i.id).includes(userId) ? [i.id] : []));
  return { ...saved, from, followed };
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

export async function inviteMemberAction(
  projectId: string,
  person: string,
  role: ListRole = "editor",
  /** They'll see only the items assigned to you. */
  onlyMine = false,
  /** With onlyMine, only those in your today or week. */
  within: OnlyWithin | null = null,
) {
  const session = await getCurrentSession();
  if (!session) redirect("/login");
  const userId = session.user.id;
  const { db } = getDb();
  const member = inviteMemberCore(db, userId, projectId, person, SOURCE, role, { onlyMine, within });

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
      role,
      onlyMine,
      within,
    };
    after(() => notifyInvite(invite));
  }

  refresh();
  return member;
}

/**
 * Invite several people to several lists and Spaces at once, each place
 * with its own role. All or nothing; each person gets one email naming
 * every place.
 */
export async function invitePeopleAction(people: string[], places: InvitePlace[]) {
  const session = await getCurrentSession();
  if (!session) redirect("/login");
  const userId = session.user.id;
  const { db } = getDb();
  const { sent, places: named } = invitePeopleCore(db, userId, { people, places }, SOURCE);

  // One email each, best-effort and after answering, like a single invite.
  const url = await appBaseUrl();
  const emails = new Map(sent.flatMap((s) => (s.member.email ? [[s.member.userId, s.member.email]] : [])));
  for (const to of emails.values()) {
    const invite = {
      to,
      inviterName: session.user.name,
      projectName: named[0]?.name ?? "",
      url,
      kind: named[0]?.kind,
      role: named[0]?.role,
      places: named.map(({ name, kind, role, onlyMine, within }) => ({ name, kind, role, onlyMine, within })),
    };
    after(() => notifyInvite(invite));
  }
  refresh();
  return sent.length;
}

/** Change what a member of the list can do on it, and whether they see only your items. */
export async function setMemberRoleAction(
  projectId: string,
  targetUserId: string,
  role: ListRole,
  onlyMine?: boolean,
  within?: OnlyWithin | null,
) {
  const userId = await requireUserId();
  const { db } = getDb();
  setMemberRoleCore(db, userId, projectId, targetUserId, role, SOURCE, onlyMine, within);
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
  /** They'll see only the items assigned to you. */
  onlyMine = false,
  /** With onlyMine, only those in your today or week. */
  within: OnlyWithin | null = null,
) {
  const session = await getCurrentSession();
  if (!session) redirect("/login");
  const { db } = getDb();
  const member = inviteSpaceMemberCore(db, session.user.id, spaceId, person, SOURCE, role, { onlyMine, within });
  // Best-effort and after answering, like a list invite.
  const space = listSpacesCore(db, session.user.id).find((s) => s.id === spaceId);
  if (member.email && space) {
    const invite = {
      to: member.email,
      inviterName: session.user.name,
      projectName: space.name,
      url: await appBaseUrl(),
      kind: "space" as const,
      role,
      onlyMine,
      within,
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
  onlyMine?: boolean,
  within?: OnlyWithin | null,
) {
  const userId = await requireUserId();
  const { db } = getDb();
  setSpaceMemberRoleCore(db, userId, spaceId, targetUserId, role, SOURCE, onlyMine, within);
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
  const from = changeSeq();
  updateItemCore(db, userId, id, { ...patch, labelEmoji }, SOURCE);
  // Labels can make new ones on the list, which the rows don't carry.
  if (patch.labels === undefined) return savedRows(db, userId, from, [id]);
  refresh();
}

/** A checklist line added from the item's dialog, with its parent (it can reopen it). */
export async function addSubItemAction(parentId: string, title: string) {
  const userId = await requireUserId();
  const { db } = getDb();
  const parent = getItemCore(db, userId, parentId);
  if (!parent) throw new Error(`item not found: ${parentId}`);
  const from = changeSeq();
  const it = addItemCore(db, userId, { projectId: parent.projectId, title, parentId }, SOURCE);
  return savedRows(db, userId, from, [it.id, parentId]);
}

/** Give an item a smart due date, change its rule or lead, or (null) make it plain again. */
export async function setSmartRuleAction(id: string, rule: { rule: string; lead: number } | null) {
  const userId = await requireUserId();
  const { db } = getDb();
  const it = setSmartRuleCore(db, userId, id, rule, SOURCE);
  refresh();
  return it;
}

export async function getSmartDueAction(id: string) {
  const userId = await requireUserId();
  const { db } = getDb();
  return getSmartDueCore(db, userId, id);
}

export async function findSmartCandidatesAction(id: string, query: string) {
  const userId = await requireUserId();
  const { db } = getDb();
  return findSmartCandidatesCore(db, userId, id, query);
}

export async function addSmartMatchAction(id: string, anchorId: string) {
  const userId = await requireUserId();
  const { db } = getDb();
  const it = addSmartMatchCore(db, userId, id, anchorId, null, SOURCE);
  refresh();
  return it;
}

/** Say a match isn't one: it stops counting and isn't matched again. */
export async function removeSmartMatchAction(id: string, anchorId: string) {
  const userId = await requireUserId();
  const { db } = getDb();
  const it = removeSmartMatchCore(db, userId, id, anchorId, SOURCE);
  refresh();
  return it;
}

export async function completeItemAction(id: string) {
  const userId = await requireUserId();
  const { db } = getDb();
  // Completing ends the agents' sessions on it, which no row shows.
  const working = groupIdsCore(db, userId, id).some(
    (i) => listOpenAgentSessionsCore(db, userId, i).length > 0,
  );
  const from = changeSeq();
  completeItemCore(db, userId, id, SOURCE);
  if (working) refresh();
  return savedRows(db, userId, from, groupIdsCore(db, userId, id));
}

export async function uncompleteItemAction(id: string) {
  const userId = await requireUserId();
  const { db } = getDb();
  const from = changeSeq();
  uncompleteItemCore(db, userId, id, SOURCE);
  return savedRows(db, userId, from, groupIdsCore(db, userId, id));
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
  const from = changeSeq();
  reorderItemCore(db, userId, id, ref, SOURCE);
  // Only its own position changes.
  return savedRows(db, userId, from, [id]);
}

export async function setItemsCollapsedAction(ids: string[], collapsed: boolean) {
  const userId = await requireUserId();
  const { db } = getDb();
  const from = changeSeq();
  setItemsCollapsedCore(db, userId, ids, collapsed);
  return savedRows(db, userId, from, ids);
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
  // The checklist it leaves and the one it joins.
  const left = groupIdsCore(db, userId, id);
  const from = changeSeq();
  setItemParentCore(db, userId, id, parentId, SOURCE, position);
  return savedRows(db, userId, from, [...left, ...groupIdsCore(db, userId, id)]);
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
  // Its sub-items go with it.
  const ids = groupIdsCore(db, userId, id);
  const from = changeSeq();
  deleteItemCore(db, userId, id, SOURCE);
  return savedRows(db, userId, from, ids);
}

/** Add a photo's reviewed lines to the board (the review screen's Add). */
export async function addFromSourceAction(sourceId: string, reviews: LineReview[]) {
  const userId = await requireUserId();
  const { db } = getDb();
  const result = addFromSourceCore(db, userId, sourceId, reviews, SOURCE);
  refresh();
  return result;
}

/** Drop a photo that hasn't been added. */
export async function discardSourceAction(sourceId: string) {
  const userId = await requireUserId();
  const { db } = getDb();
  discardSourceCore(db, userId, sourceId);
  refresh();
}

/** The photo an item was added from, and where on it, for the item's dialog. */
export async function getItemSourceAction(itemId: string) {
  const userId = await requireUserId();
  const { db } = getDb();
  return getItemSourceCore(db, userId, itemId);
}

/** An item's comments, and who a comment on it can mention: one read, as
 * Next runs a page's actions one at a time. */
export async function listCommentsAction(itemId: string) {
  const userId = await requireUserId();
  const { db } = getDb();
  return {
    comments: listCommentsCore(db, userId, itemId),
    mentionable: listMentionableCore(db, userId, itemId),
  };
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

/** Send a card in the Agenda's Get started stack to the back, for the signed-in user. */
export async function sendGetStartedToBackAction(step: GetStartedStep) {
  const userId = await requireUserId();
  const { db } = getDb();
  sendGetStartedToBackCore(db, userId, step);
  refresh();
}

/** Collapse or open the Agenda's Get started stack, for the signed-in user. */
export async function setGetStartedCollapsedAction(collapsed: boolean) {
  const userId = await requireUserId();
  const { db } = getDb();
  setGetStartedCollapsedCore(db, userId, collapsed);
  refresh();
}

/**
 * The app is open in its own window on this platform, or the user says
 * they've installed it there. A no-op once recorded.
 */
export async function recordInstallAction(platform: InstallPlatform) {
  const userId = await requireUserId();
  const { db } = getDb();
  recordInstallCore(db, userId, platform, SOURCE);
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

/**
 * Connect the signed-in user's iCloud calendars. Returns the reason in
 * words when iCloud refuses or can't be reached, since production hides a
 * thrown error's message.
 */
export async function connectICloudAction(username: string, password: string): Promise<{ error: string | null }> {
  const userId = await requireUserId();
  const config = calendarConfig();
  if (!config) return { error: "Calendars aren't set up on this server." };
  const { db } = getDb();
  try {
    await connectICloudCore(db, userId, { username, password }, SOURCE, config);
  } catch (error) {
    if (error instanceof CalendarConnectError) return { error: error.message };
    throw error;
  }
  revalidatePath("/settings/calendars");
  refresh();
  return { error: null };
}

export async function disconnectCalendarAccountAction(accountId: string) {
  const userId = await requireUserId();
  const { db } = getDb();
  disconnectCalendarAccountCore(db, userId, accountId, SOURCE);
  revalidatePath("/settings/calendars");
  refresh();
}

export async function setCalendarIncludedAction(calendarId: string, included: boolean) {
  const userId = await requireUserId();
  const config = calendarConfig();
  const { db } = getDb();
  if (!setCalendarIncludedCore(db, userId, calendarId, included, SOURCE)) return;
  // Including one fetches its events after this returns, rather than at the
  // next sync, so the page's other saves don't wait on iCloud.
  if (included && config) {
    const account = listCalendarAccountsCore(db, userId).find((a) => a.calendars.some((c) => c.id === calendarId));
    if (account) after(() => syncCalendarAccountCore(db, account.id, config));
  }
  revalidatePath("/settings/calendars");
  refresh();
}

export async function syncCalendarAccountAction(accountId: string) {
  const userId = await requireUserId();
  const config = calendarConfig();
  const { db } = getDb();
  if (!config || !listCalendarAccountsCore(db, userId).some((a) => a.id === accountId)) return;
  await syncCalendarAccountCore(db, accountId, config);
  revalidatePath("/settings/calendars");
  refresh();
}

export async function removeGithubWebhookAction() {
  const userId = await requireUserId();
  const { db } = getDb();
  removeGithubWebhookCore(db, userId, SOURCE);
  revalidatePath("/settings/github");
}

export async function createEmailAddressAction() {
  const userId = await requireUserId();
  const { db } = getDb();
  createEmailAddressCore(db, userId, SOURCE);
  revalidatePath("/settings/email");
}

export async function removeEmailAddressAction() {
  const userId = await requireUserId();
  const { db } = getDb();
  removeEmailAddressCore(db, userId, SOURCE);
  revalidatePath("/settings/email");
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
