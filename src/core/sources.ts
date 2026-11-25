import { createHash, randomBytes } from "node:crypto";
import { and, asc, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import { sniffImageType } from "../lib/favicon";
import { type Repeat, repeatOf } from "../lib/repeat";
import { isDay } from "../lib/time";
import { listAccess } from "./access";
import { type AuditOrigin, recordAudit } from "./audit";
import type { Db } from "./db";
import { addItem, assertRepeat, completeItem, getItem, updateItem } from "./items";
import type { LabelEmoji } from "./labels";
import { listAssignees } from "./members";
import { getProject } from "./projects";
import { type SourceRegion, sourceLines, sources } from "./schema";

// "Add these to Sidetrack": an agent reads a photo of a handwritten page and
// proposes a line per item (proposeFromPhoto), then uploads the photo to the
// one-time URL it gets back (receiveSourcePhoto). Nothing reaches the board
// until the photo's owner reviews the lines in the app and adds them
// (addFromSource), which is audited like any add. Until then a source is a
// proposal only its owner sees, like received email, so writing it isn't.

/** How long an upload URL works for. */
export const UPLOAD_TTL_MS = 60 * 60_000;
/** The largest photo kept: a phone photo is 2 to 5 MB. */
export const PHOTO_MAX_BYTES = 15 * 1024 * 1024;
/** Most lines one photo can propose. */
export const MAX_LINES = 200;
const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export type ProposedLine = {
  title: string;
  projectId: string;
  /** Index of an earlier line this one goes under, as a sub-item. */
  parent?: number;
  /** An existing item it goes under, as a sub-item. */
  parentItemId?: string;
  /**
   * An existing item this line is, rather than a new one. Its other fields
   * are then changes to the item: a due date, repeat or assignees replace
   * the item's, and labels are added to its own.
   */
  matchItemId?: string;
  done?: boolean;
  dueDate?: string | null;
  labels?: string[];
  repeat?: Repeat | null;
  assigneeIds?: string[];
  region?: SourceRegion;
};

function assertRegion(r: SourceRegion | undefined, i: number): SourceRegion | null {
  if (!r) return null;
  const ok = [r.x, r.y, r.w, r.h].every((v) => Number.isFinite(v) && v >= 0 && v <= 1);
  if (!ok || r.w === 0 || r.h === 0 || r.x + r.w > 1.001 || r.y + r.h > 1.001) {
    throw new Error(`line ${i}: region must be fractions of the photo, 0 to 1, inside it`);
  }
  if (r.angle !== undefined && !(Number.isFinite(r.angle) && Math.abs(r.angle) <= 180)) {
    throw new Error(`line ${i}: region angle must be degrees, -180 to 180`);
  }
  const { x, y, w, h, angle } = r;
  return angle ? { x, y, w, h, angle } : { x, y, w, h };
}

/**
 * Store lines an agent read off a photo, for `userId` to review, and return
 * the token for the one-time URL the photo goes to. Every list and item a
 * line names is checked now, so review never meets one the user can't edit.
 */
// audit-exempt: a proposal seen only by its owner; it changes nothing on the
// board until they add it, and that is audited (addFromSource).
export function proposeFromPhoto(
  db: Db,
  userId: string,
  input: { note?: string | null; lines: ProposedLine[] },
  agentName: string | null,
): { sourceId: string; uploadToken: string; expiresAt: number } {
  const { lines } = input;
  if (lines.length === 0) throw new Error("no lines: propose at least one item");
  if (lines.length > MAX_LINES) throw new Error(`too many lines: at most ${MAX_LINES}`);
  const canEdit = (projectId: string) => listAccess(db, userId, projectId) === "edit";
  const rows = lines.map((line, i) => {
    const title = line.title.trim();
    if (!title) throw new Error(`line ${i}: title is empty`);
    if (!getProject(db, userId, line.projectId) || !canEdit(line.projectId)) {
      throw new Error(`line ${i}: list not found or not yours to change: ${line.projectId}`);
    }
    if (line.parent !== undefined && (line.parent < 0 || line.parent >= i)) {
      throw new Error(`line ${i}: parent must be the index of an earlier line`);
    }
    if (line.parent !== undefined && lines[line.parent].parent !== undefined) {
      throw new Error(`line ${i}: sub-items are one level deep; its parent is a sub-item`);
    }
    if (line.parent !== undefined && lines[line.parent].projectId !== line.projectId) {
      throw new Error(`line ${i}: a sub-item goes in its parent's list`);
    }
    let itemList = line.projectId;
    for (const [key, id] of [
      ["parent item", line.parentItemId],
      ["matched item", line.matchItemId],
    ] as const) {
      if (!id) continue;
      const it = getItem(db, userId, id);
      if (!it || !canEdit(it.projectId)) throw new Error(`line ${i}: ${key} not found: ${id}`);
      itemList = it.projectId;
    }
    if (line.dueDate && !isDay(line.dueDate)) {
      throw new Error(`line ${i}: due date must be a day, YYYY-MM-DD`);
    }
    let repeat: Repeat | null;
    try {
      repeat = assertRepeat(line.repeat ?? null);
    } catch (e) {
      throw new Error(`line ${i}: ${e instanceof Error ? e.message : String(e)}`);
    }
    // Checked against the list the item will be on: a sub-item's parent's,
    // or a matched item's own.
    const people = listAssignees(db, userId, itemList).map((a) => a.userId);
    const stranger = line.assigneeIds?.find((id) => !people.includes(id));
    if (stranger) throw new Error(`line ${i}: can't assign ${stranger}: not on the list`);
    return {
      id: nanoid(12),
      ord: i,
      title,
      projectId: line.projectId,
      parentItemId: line.parentItemId ?? null,
      matchItemId: line.matchItemId ?? null,
      done: line.done ?? false,
      dueDate: line.dueDate ?? null,
      labels: line.labels ?? [],
      repeat,
      assigneeIds: [...new Set(line.assigneeIds ?? [])],
      region: assertRegion(line.region, i),
    };
  });
  const sourceId = nanoid(12);
  const uploadToken = randomBytes(24).toString("base64url");
  const now = Date.now();
  const expiresAt = now + UPLOAD_TTL_MS;
  // Two plain inserts, not a transaction: every line was checked above, and
  // a proposal isn't audited (see above).
  db.insert(sources)
    .values({
      id: sourceId,
      userId,
      kind: "photo",
      note: input.note?.trim() || null,
      agentName,
      uploadTokenHash: hashToken(uploadToken),
      uploadExpiresAt: expiresAt,
      createdAt: now,
    })
    .run();
  db.insert(sourceLines)
    .values(
      rows.map((r, i) => ({
        ...r,
        sourceId,
        parentLineId: lines[i].parent !== undefined ? rows[lines[i].parent as number].id : null,
      })),
    )
    .run();
  return { sourceId, uploadToken, expiresAt };
}

/**
 * Keep the photo uploaded to a source's one-time URL. The token works once,
 * within the hour, and only for a JPEG, PNG or WebP image; each refusal says
 * why, for the agent that sent it.
 */
// audit-exempt: completes a proposal only its owner sees (see proposeFromPhoto).
export function receiveSourcePhoto(
  db: Db,
  token: string,
  bytes: Uint8Array,
  now = Date.now(),
): { ok: true; sourceId: string } | { ok: false; status: number; error: string } {
  const source = db
    .select({ id: sources.id, expiresAt: sources.uploadExpiresAt })
    .from(sources)
    .where(eq(sources.uploadTokenHash, hashToken(token)))
    .get();
  if (!source) return { ok: false, status: 404, error: "unknown or already used upload URL" };
  if ((source.expiresAt ?? 0) < now) {
    return { ok: false, status: 410, error: "upload URL expired: propose the lines again" };
  }
  if (bytes.length === 0) return { ok: false, status: 400, error: "the file is empty" };
  if (bytes.length > PHOTO_MAX_BYTES) {
    return { ok: false, status: 413, error: "photo too large: at most 15 MB; resize it and retry" };
  }
  const contentType = sniffImageType(bytes);
  if (!contentType || !PHOTO_TYPES.includes(contentType)) {
    return {
      ok: false,
      status: 415,
      error:
        "not a JPEG, PNG or WebP image (HEIC isn't shown in every browser): convert it, " +
        "e.g. `sips -s format jpeg in.heic --out out.jpg` on a Mac, and retry",
    };
  }
  db.update(sources)
    .set({ data: Buffer.from(bytes), contentType, uploadTokenHash: null, uploadExpiresAt: null })
    .where(eq(sources.id, source.id))
    .run();
  return { ok: true, sourceId: source.id };
}

export type SourceView = {
  id: string;
  note: string | null;
  agentName: string | null;
  createdAt: number;
  reviewedAt: number | null;
  hasPhoto: boolean;
  lines: Array<typeof sourceLines.$inferSelect>;
};

/** A source `userId` owns, with its lines in page order; null otherwise. */
export function getSource(db: Db, userId: string, id: string): SourceView | null {
  const source = db
    .select({
      id: sources.id,
      note: sources.note,
      agentName: sources.agentName,
      createdAt: sources.createdAt,
      reviewedAt: sources.reviewedAt,
      contentType: sources.contentType,
    })
    .from(sources)
    .where(and(eq(sources.id, id), eq(sources.userId, userId)))
    .get();
  if (!source) return null;
  const lines = db
    .select()
    .from(sourceLines)
    .where(eq(sourceLines.sourceId, id))
    .orderBy(asc(sourceLines.ord))
    .all();
  const { contentType, ...rest } = source;
  return { ...rest, hasPhoto: contentType !== null, lines };
}

/** The photo's bytes and type, for its owner; null without one. */
export function getSourcePhoto(db: Db, userId: string, id: string) {
  const row = db
    .select({ contentType: sources.contentType, data: sources.data })
    .from(sources)
    .where(and(eq(sources.id, id), eq(sources.userId, userId)))
    .get();
  return row?.data && row.contentType ? { contentType: row.contentType, data: row.data } : null;
}

/** Photos waiting for `userId` to review, newest first, once uploaded. */
export function listPendingSources(db: Db, userId: string) {
  return db
    .select({ id: sources.id, createdAt: sources.createdAt, agentName: sources.agentName })
    .from(sources)
    .where(
      and(eq(sources.userId, userId), isNull(sources.reviewedAt), isNotNull(sources.contentType)),
    )
    .orderBy(desc(sources.createdAt))
    .all();
}

/**
 * Where an item came from: the photo and the part of it its line covers, for
 * its owner to see from the item. Null for an item that wasn't added from
 * one, or one added from someone else's photo.
 */
export function getItemSource(
  db: Db,
  userId: string,
  itemId: string,
): { sourceId: string; region: SourceRegion | null; createdAt: number } | null {
  const row = db
    .select({ sourceId: sources.id, region: sourceLines.region, createdAt: sources.createdAt })
    .from(sourceLines)
    .innerJoin(sources, eq(sources.id, sourceLines.sourceId))
    .where(
      and(
        eq(sourceLines.itemId, itemId),
        eq(sourceLines.status, "added"),
        eq(sources.userId, userId),
      ),
    )
    .get();
  return row ?? null;
}

/**
 * What the reviewer made of a line: whether to add it, and the item as it
 * should be. A field left out keeps what the line proposed. For a line that
 * matches an existing item, the fields are the item as it should end up, and
 * any that differ from it now are changed on it.
 */
export type LineReview = {
  id: string;
  /** False skips it. */
  add: boolean;
  title?: string;
  projectId?: string;
  done?: boolean;
  dueDate?: string | null;
  repeat?: Repeat | null;
  labels?: string[];
  /** The emoji for labels new to the list, by name. */
  labelEmoji?: Record<string, LabelEmoji>;
  assigneeIds?: string[];
};

const sameRepeat = (a: Repeat | null, b: Repeat | null) =>
  a?.every === b?.every && a?.unit === b?.unit && (a?.on ?? null) === (b?.on ?? null) &&
  (a?.day ?? null) === (b?.day ?? null);
const sameSet = (a: string[], b: string[]) =>
  a.length === b.length && a.every((x) => b.includes(x));

/**
 * Add the reviewed lines to the board, in page order, in one transaction:
 * a new line becomes an item (a sub-item under its parent line's item, or
 * the existing item it names), and a line matching an existing item ticks it
 * off when it's done. Every item it adds or ticks says it came from the
 * photo in its history, and the photo is logged as added with what it did.
 * A sub-item whose parent line is skipped is added on its own.
 */
export function addFromSource(
  db: Db,
  userId: string,
  sourceId: string,
  reviews: LineReview[],
  source: AuditOrigin,
): { added: number; updated: number; completed: number; skipped: number } {
  const found = getSource(db, userId, sourceId);
  if (!found) throw new Error(`photo not found: ${sourceId}`);
  if (found.reviewedAt !== null) throw new Error("this photo has already been added");
  if (!found.hasPhoto) throw new Error("the photo hasn't been uploaded yet");
  const byId = new Map(reviews.map((r) => [r.id, r]));
  const from = { sourceId, kind: "photo" as const };
  const counts = { added: 0, updated: 0, completed: 0, skipped: 0 };
  db.transaction((tx) => {
    const itemOfLine = new Map<string, string>();
    // New items go to the top of their list; the rest of a list's lines
    // follow the first, so the page keeps its order.
    const lastTopIn = new Map<string, string>();
    for (const line of found.lines) {
      const review = byId.get(line.id);
      if (!review?.add) {
        counts.skipped++;
        tx.update(sourceLines).set({ status: "skipped" }).where(eq(sourceLines.id, line.id)).run();
        continue;
      }
      const done = review.done ?? line.done;
      let itemId: string;
      if (line.matchItemId) {
        const existing = getItem(tx as unknown as Db, userId, line.matchItemId);
        if (!existing) throw new Error(`item not found: ${line.matchItemId}`);
        // Only what differs from the item now, so an untouched match is
        // just ticked off (or left), with nothing logged as changed.
        const patch: Parameters<typeof updateItem>[3] = {};
        const title = review.title?.trim();
        if (title && title !== existing.title) patch.title = title;
        const dueDate = review.dueDate !== undefined ? review.dueDate : (line.dueDate ?? existing.dueDate);
        if (dueDate !== existing.dueDate) patch.dueDate = dueDate;
        const repeat = review.repeat !== undefined ? review.repeat : (line.repeat ?? repeatOf(existing));
        if (!sameRepeat(repeat, repeatOf(existing))) patch.repeat = repeat;
        const labels = review.labels ?? [...new Set([...existing.labels, ...line.labels])];
        if (!sameSet(labels, existing.labels)) {
          patch.labels = labels;
          patch.labelEmoji = review.labelEmoji;
        }
        const assigneeIds =
          review.assigneeIds ?? (line.assigneeIds.length ? line.assigneeIds : existing.assigneeIds);
        if (!sameSet(assigneeIds, existing.assigneeIds)) patch.assigneeIds = assigneeIds;
        if (Object.keys(patch).length) {
          updateItem(tx as unknown as Db, userId, existing.id, patch, source, from);
          counts.updated++;
        }
        if (done && existing.completedAt === null) {
          completeItem(tx as unknown as Db, userId, existing.id, source, from);
          counts.completed++;
        }
        itemId = existing.id;
      } else {
        const parentFromLine = line.parentLineId ? itemOfLine.get(line.parentLineId) : undefined;
        const parentId = parentFromLine ?? line.parentItemId ?? null;
        // A sub-item goes in its parent's list, wherever the review put it.
        const projectId = parentId
          ? (getItem(tx as unknown as Db, userId, parentId)?.projectId ?? line.projectId)
          : (review.projectId ?? line.projectId);
        if (listAccess(tx as unknown as Db, userId, projectId) !== "edit") {
          throw new Error(`list not found or not yours to change: ${projectId}`);
        }
        const after = parentId ? undefined : lastTopIn.get(projectId);
        const item = addItem(
          tx as unknown as Db,
          userId,
          {
            projectId,
            title: review.title?.trim() || line.title,
            parentId,
            positionRef: after && `after:${after}`,
            dueDate: review.dueDate !== undefined ? review.dueDate : line.dueDate,
            labels: review.labels ?? line.labels,
            labelEmoji: review.labelEmoji,
            repeat: review.repeat !== undefined ? review.repeat : line.repeat,
            assigneeIds: review.assigneeIds ?? line.assigneeIds,
            completed: done,
            from,
          },
          source,
        );
        itemId = item.id;
        if (!parentId) lastTopIn.set(projectId, item.id);
        counts.added++;
      }
      itemOfLine.set(line.id, itemId);
      tx.update(sourceLines)
        .set({ status: "added", itemId })
        .where(eq(sourceLines.id, line.id))
        .run();
    }
    tx.update(sources).set({ reviewedAt: Date.now() }).where(eq(sources.id, sourceId)).run();
    recordAudit(tx as unknown as Db, {
      actor: userId,
      source,
      event: { type: "source.added", sourceId, kind: "photo", ...counts },
    });
  });
  return counts;
}

/** Drop a photo that hasn't been added, with its lines. */
// audit-exempt: discards a proposal only its owner saw; the board is untouched.
export function discardSource(db: Db, userId: string, sourceId: string): boolean {
  const { changes } = db
    .delete(sources)
    .where(and(eq(sources.id, sourceId), eq(sources.userId, userId), isNull(sources.reviewedAt)))
    .run();
  return changes > 0;
}
