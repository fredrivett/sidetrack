import { and, eq, ne } from "drizzle-orm";
import { nanoid } from "nanoid";
import { avatars, users } from "./auth-schema";
import { type AuditOrigin, recordAudit } from "./audit";
import type { Db } from "./db";
import { uploadedAvatarPath } from "../lib/avatar";
import { normalizeWebUrl } from "../lib/url";
import { isReservedUsername, validateUsername } from "../lib/username";

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
 * Change the user's handle. `raw` keeps the casing they typed (shown as
 * displayUsername); lookups and uniqueness use it lowercased, as Better Auth's
 * username plugin does at sign-up, with the same rules (lib/username.ts).
 * A case-only change is a real change. No-op when identical.
 */
export function setUsername(
  db: Db,
  userId: string,
  raw: string,
  source: AuditOrigin,
): string {
  const problem = validateUsername(raw);
  if (problem) throw new Error(problem);
  if (isReservedUsername(raw)) throw new Error(`${raw} is reserved.`);
  const username = raw.toLowerCase();
  const taken = () => new Error(`${raw} is taken.`);
  try {
    // Read inside an immediate (write-locked) transaction, so the no-op and
    // taken checks and the audit row's "from" see what this write replaces.
    db.transaction(
      (tx) => {
        const current = tx
          .select({ displayUsername: users.displayUsername })
          .from(users)
          .where(eq(users.id, userId))
          .get();
        if (!current) throw new Error("unknown user");
        if (current.displayUsername === raw) return;
        const holder = tx
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.username, username), ne(users.id, userId)))
          .get();
        if (holder) throw taken();
        tx.update(users)
          .set({ username, displayUsername: raw, updatedAt: new Date() })
          .where(eq(users.id, userId))
          .run();
        recordAudit(tx as unknown as Db, {
          actor: userId,
          source,
          action: "update",
          entityType: "profile",
          entityId: userId,
          detail: `username from @${current.displayUsername} to @${raw}`,
        });
      },
      { behavior: "immediate" },
    );
  } catch (error) {
    // Backstop: the unique index on username, should another writer win.
    if ((error as { code?: string }).code === "SQLITE_CONSTRAINT_UNIQUE") throw taken();
    throw error;
  }
  return raw;
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

/** Widest and tallest uploaded avatar accepted, in pixels. The browser sends 256. */
export const AVATAR_MAX_SIDE = 1024;

const ascii = (b: Uint8Array, at: number, length: number) =>
  String.fromCharCode(...b.subarray(at, at + length));

/**
 * The type and pixel size an uploaded avatar declares in its header, or null
 * for anything else. Only PNG and WebP: the browser re-encodes every upload
 * to one of those (see AvatarPanel), so other formats, and SVG, which can
 * carry script, never need storing. The size is checked so a small file
 * can't declare a huge canvas that exhausts a viewer's memory when decoded.
 */
function readAvatarHeader(b: Uint8Array) {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (b.length < 30) return null;
  if (
    b[0] === 0x89 && ascii(b, 1, 3) === "PNG" && ascii(b, 12, 4) === "IHDR"
  ) {
    return { contentType: "image/png", width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (ascii(b, 0, 4) !== "RIFF" || ascii(b, 8, 4) !== "WEBP") return null;
  const contentType = "image/webp";
  const u24 = (at: number) => view.getUint16(at, true) | (b[at + 2] << 16);
  switch (ascii(b, 12, 4)) {
    case "VP8 ": // lossy: 14-bit sizes after the 9d 01 2a start code
      if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
      return {
        contentType,
        width: view.getUint16(26, true) & 0x3fff,
        height: view.getUint16(28, true) & 0x3fff,
      };
    case "VP8L": { // lossless: 14-bit sizes minus one, after the 0x2f signature
      if (b[20] !== 0x2f) return null;
      const bits = view.getUint32(21, true);
      return { contentType, width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
    case "VP8X": // extended: 24-bit canvas sizes minus one
      return { contentType, width: u24(24) + 1, height: u24(27) + 1 };
    default:
      return null;
  }
}

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
  // Read inside an immediate (write-locked) transaction, so the no-op check
  // and the audit row see the value this write actually replaces.
  db.transaction(
    (tx) => {
      const current = getProfile(tx as unknown as Db, userId);
      if (!current) throw new Error("unknown user");
      if (current.image === image) return;
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
    },
    { behavior: "immediate" },
  );
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
  const header = readAvatarHeader(bytes);
  if (!header) throw new Error("avatar must be a PNG or WebP image");
  const { contentType, width, height } = header;
  if (width === 0 || height === 0 || width > AVATAR_MAX_SIDE || height > AVATAR_MAX_SIDE) {
    throw new Error(`avatar must be at most ${AVATAR_MAX_SIDE}×${AVATAR_MAX_SIDE} pixels`);
  }

  const updatedAt = new Date();
  const data = Buffer.from(bytes);
  // A random version, not the time: two uploads in one millisecond would
  // otherwise share a URL that browsers cache as immutable.
  const image = uploadedAvatarPath(userId, nanoid(10));
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
