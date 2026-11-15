import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { RELEASE } from "@/lib/release";
import { type McpContext, registerTools } from "./tools";

// Sent to every client on connect, so each agent learns how to show its work
// without every repo's AGENTS.md repeating it. Keep it in step with the
// start_work / report_work / finish_work descriptions in tools.ts.
const INSTRUCTIONS = `Sidetrack is the user's task board: lists of items, each with a short ref such as SDT-42.

When you work on an item, show it on the board:
1. Call start_work with the item's ref and, when you have one, thread_url (a link to your own thread or session). You appear on the item, and the user is assigned if nobody was.
2. Name your git branch the \`branch\` start_work returns: the lowercased ref, then a slug of the title, e.g. sdt-42-show-agent-work-sessions. Refs are never zero-padded.
3. Title your pull request with the ref in square brackets at the end, e.g. "Show agent work sessions [SDT-42]" (start_work's \`pr_title\`), then call link_item_to_pr with the PR URL.
4. Call report_work with one short line at each milestone (PR opened, blocked, tests failing). Without a report for about 15 minutes you show as idle.
5. Call finish_work when you stop. When the work lands (the PR merges), complete_item completes the item and ends your session.

If the user has set up Sidetrack's GitHub webhook, the bracketed ref in the PR title links the PR and merging it completes the item on its own; calling complete_item as well is harmless. A link you make with link_item_to_pr stays even if the ref is later edited out of the title, so skip it when the title already names the item.`;

export function buildServer(ctx: McpContext) {
  const server = new McpServer(
    // The deployed commit, so an agent session shows which build it's on.
    { name: "sidetrack", version: RELEASE.slice(0, 7) || "dev" },
    { capabilities: { tools: {} }, instructions: INSTRUCTIONS },
  );
  registerTools(server, ctx);
  return server;
}
