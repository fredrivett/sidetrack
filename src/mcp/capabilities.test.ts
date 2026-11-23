import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createTestDb } from "@/core/test-helpers";
import { buildServer } from "./server";

const ctx = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/core/db", () => ({ getDb: () => ({ db: ctx.db }) }));
vi.mock("@/lib/env", () => ({ getEnv: () => ({}) }));

// Anything a person can do in the app, an agent can do through MCP, with the
// same core rules and audit (src/mcp/AGENTS.md). So every Server Action is
// either done by a tool or exempt for one of these reasons, and nothing else:
// "it's a setting" or "it's rarely needed" isn't one.
const REASONS = {
  // It creates, shows or redirects a secret: a leaked key must never be able
  // to widen its own reach.
  credential: true,
  // How the person appears to others: that change comes from them.
  identity: true,
  // The app's own UI or devices, meaning nothing outside it.
  view: true,
  // The app does it on its own, not the person.
  background: true,
} as const;

type Exempt = { exempt: keyof typeof REASONS; note: string };

/** Each action: the tool that does it, or why no tool should. */
const ACTIONS: Record<string, string | Exempt> = {
  createProjectAction: "create_list",
  updateProjectAction: "update_list",
  clearDoneItemsAction: "clear_done",
  setProjectSpaceAction: "update_list",
  reorderProjectAction: "reorder_list",
  deleteProjectAction: "delete_list",
  listMembersAction: "list_members",
  listSuggestedCollaboratorsAction: "list_collaborators",
  inviteMemberAction: "invite_member",
  invitePeopleAction: "invite_people",
  inviteByEmailAction: "invite_by_email",
  resendInvitationAction: "resend_invitation",
  cancelInvitationAction: "cancel_invitation",
  acceptInvitationAction: { exempt: "credential", note: "redeems an invite link's secret token" },
  setMemberRoleAction: "set_member_role",
  removeMemberAction: "remove_member",
  updateDayShareAction: "update_day_share",
  stopDayShareAction: "stop_day_share",
  alreadySharedAction: "lists_shared_whole",
  shareDayAction: "share_day",
  acceptDayShareAction: "accept_day_share",
  declineDayShareAction: "decline_day_share",
  leaveDayShareAction: "leave_day_share",
  createSpaceAction: "create_space",
  updateSpaceAction: "update_space",
  reorderSpaceAction: "reorder_space",
  deleteSpaceAction: "delete_space",
  listSpaceMembersAction: "list_space_members",
  listSuggestedSpaceMembersAction: "list_collaborators",
  inviteSpaceMemberAction: "invite_space_member",
  removeSpaceMemberAction: "remove_space_member",
  setSpaceMemberRoleAction: "set_space_member_role",
  acceptSpaceInviteAction: "accept_invite",
  declineSpaceInviteAction: "decline_invite",
  acceptInviteAction: "accept_invite",
  declineInviteAction: "decline_invite",
  leaveProjectAction: "leave_list",
  sendFeedbackAction: "send_feedback",
  addFeedbackFollowUpAction: "add_to_feedback",
  addItemAction: "add_item",
  addSubItemAction: "add_item",
  updateItemAction: "update_item",
  setSmartRuleAction: "set_smart_due",
  getSmartDueAction: "get_item",
  // Agents find items to match with list_all_items.
  findSmartCandidatesAction: "list_all_items",
  addSmartMatchAction: "add_smart_match",
  removeSmartMatchAction: "remove_smart_match",
  completeItemAction: "complete_item",
  cancelItemAction: "cancel_item",
  uncompleteItemAction: "uncomplete_item",
  listDoneBeforeAction: "search_done",
  getItemWithSubItemsAction: "get_item",
  reorderItemAction: "reorder_item",
  setItemsCollapsedAction: { exempt: "view", note: "folding sub-items on the board" },
  sortItemsAction: "sort_items",
  // A whole order at once (the board's undo of a sort); agents move one at a time.
  setItemOrderAction: "reorder_item",
  setItemParentAction: "set_item_parent",
  previewMoveItemAction: "move_item",
  moveItemAction: "move_item",
  deleteItemAction: "delete_item",
  listCommentsAction: "get_item",
  listRecentCommentsAction: "list_recent_comments",
  addCommentAction: "add_comment",
  updateCommentAction: "update_comment",
  deleteCommentAction: "delete_comment",
  setNoDateCollapsedAction: { exempt: "view", note: "folding the Agenda's No date" },
  setNoDateListFoldedAction: { exempt: "view", note: "folding a list's card in No date" },
  setOverdueCollapsedAction: { exempt: "view", note: "folding the Agenda's Overdue" },
  sendGetStartedToBackAction: { exempt: "view", note: "the Get started card stack" },
  setGetStartedCollapsedAction: { exempt: "view", note: "the Get started card stack" },
  markPostSeenAction: { exempt: "view", note: "the Brief's stack of changelog posts" },
  recordInstallAction: { exempt: "background", note: "the app noticing it's installed" },
  setAgendaReadAction: { exempt: "view", note: "the greeting the user has read in the app" },
  setDayNoteAction: { exempt: "view", note: "only the in-app greeting reads it" },
  setTimeZoneAction: { exempt: "background", note: "synced from the browser" },
  setBoardFiltersAction: { exempt: "view", note: "the board's filters" },
  setGreetingPrefsAction: { exempt: "view", note: "how the in-app greeting reads" },
  uploadAvatarAction: { exempt: "identity", note: "their picture" },
  setUsernameAction: { exempt: "identity", note: "their name to others" },
  setAvatarUrlAction: { exempt: "identity", note: "their picture" },
  addLabelAction: "add_label",
  updateLabelAction: "update_label",
  deleteLabelAction: "delete_label",
  listLabelUsageAction: "list_labels",
  listLabelsAction: "list_labels",
  listAuditAction: "list_audit",
  createApiKeyAction: { exempt: "credential", note: "a key mustn't mint more keys" },
  revokeApiKeyAction: { exempt: "credential", note: "API keys" },
  addGithubWebhookSecretAction: { exempt: "credential", note: "GitHub webhook secret" },
  removeGithubWebhookSecretAction: { exempt: "credential", note: "GitHub webhook secret" },
  removeGithubWebhookAction: { exempt: "credential", note: "GitHub webhook" },
  connectICloudAction: { exempt: "credential", note: "an app-specific password" },
  disconnectCalendarAccountAction: { exempt: "credential", note: "a connected calendar account" },
  setCalendarIncludedAction: { exempt: "view", note: "which calendars the Agenda shows" },
  syncCalendarAccountAction: { exempt: "background", note: "calendars sync on their own" },
  createEmailAddressAction: { exempt: "credential", note: "an inbound address anyone can send items to" },
  removeEmailAddressAction: { exempt: "credential", note: "an inbound address" },
  setAgentWebhookAction: { exempt: "credential", note: "where an agent's requests go, and their secret" },
  removeAgentWebhookAction: { exempt: "credential", note: "an agent's webhook" },
  setFollowingAction: "follow_item",
  setNotificationLevelAction: "set_notification_level",
  markNotificationsReadAction: "mark_notifications_read",
  savePushSubscriptionAction: { exempt: "credential", note: "a device's push keys" },
  removePushSubscriptionAction: { exempt: "credential", note: "a device's push keys" },
  sendTestPushAction: { exempt: "view", note: "checks push on the user's own devices" },
  startAgentAction: "assign_agent",
  stopAgentAction: "unassign_agent",
  addFromSourceAction: "add_photo_lines",
  discardSourceAction: "discard_photo",
  getItemSourceAction: "get_item",
  getReplacementAction: "get_item",
};

function serverActions(): string[] {
  const source = readFileSync(join(__dirname, "../app/actions.ts"), "utf8");
  return [...source.matchAll(/^export async function (\w+)/gm)].map((m) => m[1]);
}

async function registeredTools(): Promise<Set<string>> {
  ctx.db = createTestDb().db;
  const server = buildServer({
    userId: "u",
    agent: { keyId: "k", name: "Test" },
    baseUrl: "http://localhost:3000",
  });
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0" });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return new Set((await client.listTools()).tools.map((t) => t.name));
}

describe("MCP capabilities", () => {
  it("has a tool, or a reason there isn't one, for every Server Action", () => {
    const actions = serverActions();
    const missing = actions.filter((a) => !(a in ACTIONS));
    // A new action fails here: add its tool (see src/mcp/AGENTS.md), or an
    // exemption for one of REASONS.
    expect(missing).toEqual([]);
    // And a removed one leaves no entry behind.
    expect(Object.keys(ACTIONS).filter((a) => !actions.includes(a))).toEqual([]);
  });

  it("names only registered tools and known reasons", async () => {
    const tools = await registeredTools();
    for (const [action, covered] of Object.entries(ACTIONS)) {
      if (typeof covered === "string") {
        expect(tools.has(covered), `${action} → ${covered}`).toBe(true);
      } else {
        expect(Object.keys(REASONS), action).toContain(covered.exempt);
        expect(covered.note.trim(), action).not.toBe("");
      }
    }
  });
});
