import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { RELEASE } from "@/lib/release";
import { type McpContext, registerTools } from "./tools";

// Sent to every client on connect, so each agent learns how to show its work
// without every repo's AGENTS.md repeating it. Keep it in step with the
// start_work / report_work / finish_work descriptions in tools.ts.
const INSTRUCTIONS = `Sidetrack is the user's task board: lists of items, each with a short ref such as SDT-42. An item can have sub-items, one level deep, which the board shows as its checklist.

When you work on an item, show it on the board:
1. Find the item first, in the list the repository's AGENTS.md names, or else the list the user names; if neither names one, ask the user which list to use. Read the list with get_list and look for an open item that describes the work. If one matches, use it, and update its title, description or sub-items when they no longer describe the work. If none matches, create one with add_item. If you're unsure whether an item matches, or more than one could, ask the user before creating or changing anything.
2. Each pull request covers exactly one item. When the work needs more than one PR, give the item a sub-item per PR (add_item with parent) and work on each sub-item as its own item, titling each PR with the sub-item's ref, never the parent's: merging completes the items a PR names, completing a parent completes all its sub-items, and a parent completes on its own when its last sub-item does.
3. Call start_work with the item's ref and, when you have one, thread_url (a link to your own thread or session). You appear on the item, and the user is assigned if nobody was.
4. Name your git branch the \`branch\` start_work returns: the lowercased ref, then a slug of the title, e.g. sdt-42-show-agent-work-sessions. Refs are never zero-padded.
5. Title your pull request with the ref in square brackets at the end, e.g. "Show agent work sessions [SDT-42]" (start_work's \`pr_title\`), then call link_item_to_pr with the PR URL.
6. Call report_work with one short line at each milestone (PR opened, blocked, tests failing). Without a report for about 15 minutes you show as idle.
7. Call finish_work when you stop. When the work lands (the PR merges), complete_item completes the item and ends your session.

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
