import { eq } from "drizzle-orm";
import { avatars, users } from "./auth-schema";
import { type AuditOrigin, recordAudit } from "./audit";
import type { Db } from "./db";
import { uploadedAvatarPath } from "../lib/avatar";
import { normalizeWebUrl } from "../lib/url";

/** The IANA timezone the user's browser last reported, or null. */
export function getTimeZone(db: Db, userId: string): string | null {
  return (
    db
      .select({ timeZone: users.timeZone })
      .from(users)
      .where(eq(users.id, userId))
      .get()?.timeZone ?? null
  );
}

/** The display fields for the user's own avatar and name, or null if unknown. */
export function getProfile(db: Db, userId: string) {
  return (
    db
      .select({
        userId: users.id,
        displayUsername: users.displayUsername,
        name: users.name,
        email: users.email,
        image: users.image,
      })
      .from(users)
      .where(eq(users.id, userId))
      .get() ?? null
  );
}

/**
 * Save the timezone the user's browser reports, so agents work out "today"
 * the way the user's screen does. Not audited, deliberately: it's the device
 * reporting where it is, not something the user did, and logging every sync
 * would be noise (like ensureCategory). Saves the zone's canonical name and
 * rejects anything that isn't an IANA zone the runtime knows.
 */
export function setTimeZone(db: Db, userId: string, timeZone: string): void {
  let canonical: string;
  try {
    canonical = new Intl.DateTimeFormat("en", { timeZone }).resolvedOptions().timeZone;
  } catch {
    throw new Error(`unknown timezone: ${timeZone}`);
  }
  // Fixed offsets like "+05:00" parse too, but they aren't zones: no DST.
  if (/^[+-]/.test(canonical)) throw new Error(`unknown timezone: ${timeZone}`);
  // audit-exempt: the device reporting its zone, not a user action
  // (see above).
  db.update(users).set({ timeZone: canonical }).where(eq(users.id, userId)).run();
}

/** Largest uploaded avatar accepted. The browser shrinks images to 256px first, so real uploads are far below this. */
export const AVATAR_MAX_BYTES = 512 * 1024;

// Raster formats an <img> renders, told apart by their first bytes rather
// than the client's claimed type. Anything else (SVG, which can carry script,
// HTML, arbitrary files) is rejected.
const AVATAR_SIGNATURES: [string, (b: Uint8Array) => boolean][] = [
  ["image/png", (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47],
  ["image/jpeg", (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
  ["image/gif", (b) => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38],
  [
    "image/webp",
    (b) =>
      String.fromCharCode(...b.subarray(0, 4)) === "RIFF" &&
      String.fromCharCode(...b.subarray(8, 12)) === "WEBP",
  ],
];

/**
 * Set the user's avatar to a pasted image URL, or clear it with null or blank.
 * Normalized like a list icon URL: a bare host gains https://, and anything
 * that isn't an http(s) web address (javascript:, data:, typos) throws. Drops
 * any uploaded image, which nothing points at anymore. No-op when unchanged.
 */
export function setAvatarUrl(
  db: Db,
  userId: string,
  raw: string | null,
  source: AuditOrigin,
): string | null {
  const image = raw === null ? null : normalizeWebUrl(raw, "avatar URL");
  const current = getProfile(db, userId);
  if (!current) throw new Error("unknown user");
  if (current.image === image) return image;
  db.transaction((tx) => {
    tx.update(users)
      .set({ image, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .run();
    tx.delete(avatars).where(eq(avatars.userId, userId)).run();
    recordAudit(tx as unknown as Db, {
      actor: userId,
      source,
      action: image ? "update" : "delete",
      entityType: "profile",
      entityId: userId,
      detail: image ? `avatar to ${image}` : "avatar",
    });
  });
  return image;
}

/**
 * Store an uploaded avatar and point the user's image at it, replacing any
 * earlier upload. Returns the versioned path it's served from.
 */
export function setUploadedAvatar(
  db: Db,
  userId: string,
  bytes: Uint8Array,
  source: AuditOrigin,
): string {
  if (bytes.length === 0) throw new Error("avatar file is empty");
  if (bytes.length > AVATAR_MAX_BYTES) throw new Error("avatar file is too large");
  const contentType = AVATAR_SIGNATURES.find(([, matches]) => matches(bytes))?.[0];
  if (!contentType) throw new Error("avatar must be a PNG, JPEG, GIF, or WebP image");

  const updatedAt = new Date();
  const data = Buffer.from(bytes);
  const image = uploadedAvatarPath(userId, updatedAt.getTime());
  db.transaction((tx) => {
    tx.insert(avatars)
      .values({ userId, contentType, data, updatedAt })
      .onConflictDoUpdate({ target: avatars.userId, set: { contentType, data, updatedAt } })
      .run();
    tx.update(users).set({ image, updatedAt }).where(eq(users.id, userId)).run();
    recordAudit(tx as unknown as Db, {
      actor: userId,
      source,
      action: "update",
      entityType: "profile",
      entityId: userId,
      detail: "avatar to an uploaded image",
    });
  });
  return image;
}

/** The user's uploaded avatar bytes and type, or null if they have none. */
export function getUploadedAvatar(db: Db, userId: string) {
  return (
    db
      .select({ contentType: avatars.contentType, data: avatars.data })
      .from(avatars)
      .where(eq(avatars.userId, userId))
      .get() ?? null
  );
}
