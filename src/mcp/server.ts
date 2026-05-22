import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTools } from "./tools";

export function buildServer(ctx: { userId: string }) {
  const server = new McpServer(
    { name: "sidetrack", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );
  registerTools(server, ctx);
  return server;
}
