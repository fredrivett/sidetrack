import { describe, expect, it } from "vitest";
import { listAgentWebhooks, removeAgentWebhook, setAgentWebhook } from "./agentWebhooks";
import { createApiKey, revokeApiKey } from "./api-keys";
import { listAudit } from "./audit";
import { agentWebhooks } from "./schema";
import { createTestDb, createTestUser } from "./test-helpers";

const HOOK_URL = "https://ampcode.com/webhooks/abc123secretpath";

function setup() {
  const { db } = createTestDb();
  const fred = createTestUser(db);
  const { record } = createApiKey(db, fred, "Amp", "web");
  return { db, fred, keyId: record.id };
}

describe("agent webhooks", () => {
  it("saves the URL with a fresh secret each time, auditing without either", () => {
    const { db, fred, keyId } = setup();
    const first = setAgentWebhook(db, fred, keyId, HOOK_URL, "web");
    const second = setAgentWebhook(db, fred, keyId, "https://example.com/hook", "web");

    expect(first.secret).toMatch(/^[0-9a-f]{64}$/);
    expect(second.secret).not.toBe(first.secret);
    // One row per key, holding the latest HOOK_URL and secret.
    expect(db.select().from(agentWebhooks).all()).toEqual([
      expect.objectContaining({ keyId, url: "https://example.com/hook", secret: second.secret }),
    ]);
    expect(listAgentWebhooks(db, fred).map((w) => w.keyId)).toEqual([keyId]);

    const rows = listAudit(db, fred).filter((e) => e.entityId === keyId);
    expect(rows.map((e) => e.action)).toEqual(["update", "create", "create"]);
    for (const e of rows) {
      expect(e.detail).not.toContain("abc123secretpath");
      expect(e.detail).not.toContain(first.secret);
    }
  });

  it("refuses a HOOK_URL that isn't https, and another person's key", () => {
    const { db, fred, keyId } = setup();
    const other = createTestUser(db);
    expect(() => setAgentWebhook(db, fred, keyId, "http://example.com/hook", "web")).toThrow(
      /https/,
    );
    expect(() => setAgentWebhook(db, other, keyId, HOOK_URL, "web")).toThrow(/not found/);
    expect(db.select().from(agentWebhooks).all()).toEqual([]);
    expect(listAgentWebhooks(db, other)).toEqual([]);
  });

  it("goes when it's removed or its key is revoked", () => {
    const { db, fred, keyId } = setup();
    const other = createTestUser(db);
    setAgentWebhook(db, fred, keyId, HOOK_URL, "web");

    expect(removeAgentWebhook(db, other, keyId, "web")).toBe(false);
    expect(removeAgentWebhook(db, fred, keyId, "web")).toBe(true);
    // Nothing left to remove, so nothing is logged.
    const logged = listAudit(db, fred).length;
    expect(removeAgentWebhook(db, fred, keyId, "web")).toBe(false);
    expect(listAudit(db, fred).length).toBe(logged);

    setAgentWebhook(db, fred, keyId, HOOK_URL, "web");
    revokeApiKey(db, fred, keyId, "web");
    expect(db.select().from(agentWebhooks).all()).toEqual([]);
  });
});
