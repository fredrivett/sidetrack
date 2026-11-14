import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { type McpContext, registerTools } from "./tools";

export function buildServer(ctx: McpContext) {
  const server = new McpServer(
    { name: "sidetrack", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );
  registerTools(server, ctx);
  return server;
}
