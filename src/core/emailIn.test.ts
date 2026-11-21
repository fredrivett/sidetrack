import { describe, expect, it } from "vitest";
import { listAudit } from "./audit";
import {
  createEmailAddress,
  getEmailAddress,
  type InboundEmail,
  MAX_TEXT,
  receiveEmail,
  removeEmailAddress,
  signDelivery,
  verifyDelivery,
} from "./emailIn";
import { inboundEmails } from "./schema";
import { createTestDb, createTestUser } from "./test-helpers";

const DOMAIN = "to.sidetrack.it";

function email(to: string, overrides: Partial<InboundEmail> = {}): InboundEmail {
  return {
    to,
    from: { address: "ann@example.com", name: "Ann" },
    messageId: "<m1@example.com>",
    subject: "Invoice due Friday",
    text: "Please pay by Friday.",
    sentAt: 1_700_000_000_000,
    ...overrides,
  };
}

describe("email in", () => {
  it("stores mail for the address's owner, once per Message-ID", () => {
    const { db } = createTestDb();
    const u = createTestUser(db);
    const other = createTestUser(db);
    const { token } = createEmailAddress(db, u, "web");
    createEmailAddress(db, other, "web");

    // Mail servers may upper-case the address.
    const first = receiveEmail(db, DOMAIN, email(`${token.toUpperCase()}@TO.sidetrack.it`));
    expect(first.status).toBe("stored");
    expect(receiveEmail(db, DOMAIN, email(`${token}@${DOMAIN}`)).status).toBe("duplicate");
    expect(
      receiveEmail(db, DOMAIN, email(`${token}@${DOMAIN}`, { messageId: "<m2@example.com>" }))
        .status,
    ).toBe("stored");

    const rows = db.select().from(inboundEmails).all();
    expect(rows.map((r) => r.userId)).toEqual([u, u]);
    expect(getEmailAddress(db, u)?.lastReceivedAt).not.toBeNull();
    expect(getEmailAddress(db, other)?.lastReceivedAt).toBeNull();
  });

  it("caps the kept text", () => {
    const { db } = createTestDb();
    const u = createTestUser(db);
    const { token } = createEmailAddress(db, u, "web");
    receiveEmail(db, DOMAIN, email(`${token}@${DOMAIN}`, { text: "x".repeat(MAX_TEXT + 5) }));
    expect(db.select().from(inboundEmails).get()?.text.length).toBe(MAX_TEXT);
  });

  it("refuses unknown tokens, other domains, and replaced or removed addresses", () => {
    const { db } = createTestDb();
    const u = createTestUser(db);
    const old = createEmailAddress(db, u, "web");
    expect(receiveEmail(db, DOMAIN, email(`nobody@${DOMAIN}`)).status).toBe("unknown");
    expect(receiveEmail(db, DOMAIN, email(`${old.token}@sidetrack.it`)).status).toBe("unknown");

    const replaced = createEmailAddress(db, u, "web");
    expect(replaced.token).not.toBe(old.token);
    expect(receiveEmail(db, DOMAIN, email(`${old.token}@${DOMAIN}`)).status).toBe("unknown");
    expect(receiveEmail(db, DOMAIN, email(`${replaced.token}@${DOMAIN}`)).status).toBe("stored");

    expect(removeEmailAddress(db, u, "web")).toBe(true);
    expect(
      receiveEmail(db, DOMAIN, email(`${replaced.token}@${DOMAIN}`, { messageId: "<m9@x>" }))
        .status,
    ).toBe("unknown");
    expect(removeEmailAddress(db, u, "web")).toBe(false);

    expect(
      listAudit(db, u)
        .filter((e) => e.entityType === "email_address")
        .map((e) => [e.action, e.detail])
        .reverse(),
    ).toEqual([
      ["create", "set up an email forwarding address"],
      ["update", "replaced the email forwarding address"],
      ["delete", "turned off email forwarding"],
    ]);
  });

  it("verifies the Worker's signature and refuses stale or altered deliveries", () => {
    const now = 1_800_000_000_000;
    const ts = String(now);
    const body = '{"to":"a@b"}';
    const sig = `sha256=${signDelivery("s3cret", ts, body)}`;
    expect(verifyDelivery("s3cret", body, ts, sig, now)).toBe(true);
    expect(verifyDelivery("s3cret", body, ts, sig, now + 4 * 60_000)).toBe(true);
    expect(verifyDelivery("s3cret", body, ts, sig, now + 6 * 60_000)).toBe(false);
    expect(verifyDelivery("other", body, ts, sig, now)).toBe(false);
    expect(verifyDelivery("s3cret", body + " ", ts, sig, now)).toBe(false);
    // The timestamp is signed too, so it can't be refreshed on a captured body.
    expect(verifyDelivery("s3cret", body, String(now + 1), sig, now)).toBe(false);
    expect(verifyDelivery("s3cret", body, null, sig, now)).toBe(false);
    expect(verifyDelivery("s3cret", body, ts, signDelivery("s3cret", ts, body), now)).toBe(false);
  });
});
