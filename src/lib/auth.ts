import { timingSafeEqual } from "node:crypto";

export const WEB_COOKIE = "web_token";

export function safeCompare(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export function getWebToken(): string {
  const t = process.env.WEB_TOKEN;
  if (!t) throw new Error("WEB_TOKEN is not set");
  return t;
}

export function getMcpToken(): string {
  const t = process.env.MCP_TOKEN;
  if (!t) throw new Error("MCP_TOKEN is not set");
  return t;
}
