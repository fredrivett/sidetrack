import { createHmac, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { customAlphabet, nanoid } from "nanoid";
import { type AuditOrigin, recordAudit } from "./audit";
import type { Db } from "./db";
import { emailAddresses, inboundEmails } from "./schema";

// Email in: each user can have an address, `<token>@<EMAIL_IN_DOMAIN>`, and
// mail sent or forwarded to it is stored for triage against their lists. A
// Cloudflare Worker (workers/email-in) receives the mail, parses it, and posts
// it to /api/email/inbound, signed with the secret it shares with this server.

// Mail servers may change a local part's case, so tokens are lowercase.
const newToken = customAlphabet("abcdefghijklmnopqrstuvwxyz0123456789", 16);

/** Most of an email's text that's kept; triage needs the gist, not a thread's history. */
export const MAX_TEXT = 20_000;

/** How old a delivery's timestamp may be, so a captured one can't be replayed later. */
const MAX_AGE_MS = 5 * 60_000;

export type EmailAddressView = {
  id: string;
  token: string;
  createdAt: number;
  lastReceivedAt: number | null;
};

export function getEmailAddress(db: Db, userId: string): EmailAddressView | null {
  return (
    db
      .select({
        id: emailAddresses.id,
        token: emailAddresses.token,
        createdAt: emailAddresses.createdAt,
        lastReceivedAt: emailAddresses.lastReceivedAt,
      })
      .from(emailAddresses)
      .where(eq(emailAddresses.userId, userId))
      .get() ?? null
  );
}

/**
 * Give the user a new address. Replaces any address they had, which then
 * refuses mail, so a leaked address can be swapped for one nobody knows.
 */
export function createEmailAddress(
  db: Db,
  userId: string,
  source: AuditOrigin,
): EmailAddressView {
  const existing = getEmailAddress(db, userId);
  const id = nanoid(12);
  db.transaction((tx) => {
    if (existing) tx.delete(emailAddresses).where(eq(emailAddresses.id, existing.id)).run();
    tx.insert(emailAddresses)
      .values({ id, userId, token: newToken(), createdAt: Date.now() })
      .run();
    recordAudit(tx as unknown as Db, {
      actor: userId,
      source,
      event: { type: "email.address.created", addressId: id, replaced: existing !== null },
    });
  });
  const created = getEmailAddress(db, userId);
  if (!created) throw new Error(`email address not found after creating it: ${id}`);
  return created;
}

/** Turn email in off for the user: mail to their address is then refused. */
export function removeEmailAddress(db: Db, userId: string, source: AuditOrigin): boolean {
  const existing = getEmailAddress(db, userId);
  if (!existing) return false;
  db.transaction((tx) => {
    tx.delete(emailAddresses).where(eq(emailAddresses.id, existing.id)).run();
    recordAudit(tx as unknown as Db, {
      actor: userId,
      source,
      event: { type: "email.address.removed", addressId: existing.id },
    });
  });
  return true;
}

/** The HMAC the Worker signs a delivery with: over `<timestamp>.<body>`, as hex. */
export function signDelivery(secret: string, timestamp: string, body: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

/**
 * Whether a delivery came from the Worker: its `sha256=<hex>` signature
 * matches the shared secret, in constant time, and its timestamp (Unix
 * milliseconds) is within a few minutes of `now`.
 */
export function verifyDelivery(
  secret: string,
  body: string,
  timestamp: string | null,
  signature: string | null,
  now = Date.now(),
): boolean {
  if (!timestamp || !/^\d+$/.test(timestamp) || !signature?.startsWith("sha256=")) return false;
  if (Math.abs(now - Number(timestamp)) > MAX_AGE_MS) return false;
  const given = Buffer.from(signature.slice("sha256=".length), "hex");
  const expected = Buffer.from(signDelivery(secret, timestamp, body), "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export type InboundEmail = {
  /** The envelope recipient, `<token>@<domain>`. */
  to: string;
  from: { address: string; name: string | null };
  messageId: string;
  subject: string;
  text: string;
  /** The Date header as Unix milliseconds, when it parsed. */
  sentAt: number | null;
};

/**
 * Store an email sent to `<token>@<domain>` for the address's owner.
 * `unknown`: no address has that token, or it's on another domain, so the
 * Worker bounces it. `duplicate`: a delivery of this Message-ID was already
 * stored, as when the Worker retries.
 */
export function receiveEmail(
  db: Db,
  domain: string,
  email: InboundEmail,
): { status: "stored"; id: string } | { status: "duplicate" | "unknown" } {
  const at = email.to.lastIndexOf("@");
  const local = email.to.slice(0, at).toLowerCase();
  if (at < 0 || email.to.slice(at + 1).toLowerCase() !== domain) return { status: "unknown" };
  const address = db
    .select({ id: emailAddresses.id, userId: emailAddresses.userId })
    .from(emailAddresses)
    .where(eq(emailAddresses.token, local))
    .get();
  if (!address) return { status: "unknown" };
  const id = nanoid(12);
  const now = Date.now();
  // audit-exempt: received mail waiting for triage, seen by nobody but its
  // owner; it changes nothing on the board until someone acts on it, and
  // that change is audited.
  const inserted = db
    .insert(inboundEmails)
    .values({
      id,
      userId: address.userId,
      messageId: email.messageId,
      fromAddress: email.from.address,
      fromName: email.from.name,
      subject: email.subject,
      text: email.text.slice(0, MAX_TEXT),
      sentAt: email.sentAt,
      receivedAt: now,
    })
    .onConflictDoNothing()
    .run();
  // audit-exempt: delivery telemetry, like a GitHub secret's last delivery.
  db.update(emailAddresses)
    .set({ lastReceivedAt: now })
    .where(eq(emailAddresses.id, address.id))
    .run();
  return inserted.changes === 0 ? { status: "duplicate" } : { status: "stored", id };
}
