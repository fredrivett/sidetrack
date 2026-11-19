import { and, asc, count, eq, gt, isNull, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  FEEDBACK_AREAS,
  FEEDBACK_CONTEXT_MAX,
  FEEDBACK_KINDS,
  FEEDBACK_MAX,
  type FeedbackArea,
  type FeedbackKind,
  type FeedbackRating,
} from "../lib/feedback";
import { formatItemRef } from "../lib/itemRef";
import { type AuditOrigin, recordAudit } from "./audit";
import type { Db } from "./db";
import { resolvePosition } from "./fracidx";
import { ensureLabels, type LabelEmoji } from "./labels";
import { users } from "./auth-schema";
import { auditLog, items, projects } from "./schema";

// Feedback from anyone signed in, filed as an item in one list (the
// deployment's FEEDBACK_LIST_ID). The reporter isn't a member of that list,
// so this is the one way to add an item to a list you can't open: it can only
// add, to that list, and the reporter can't see the item afterwards.

/** Each kind's label on the item, plus the one every feedback item carries. */
const KIND_LABELS: Record<FeedbackKind, string> = { bug: "Bug", idea: "Idea", other: "Other" };
const FEEDBACK_LABEL = "Feedback";
const LABEL_EMOJI: Record<string, LabelEmoji> = {
  Bug: { emoji: "🐛", chosen: true },
  Idea: { emoji: "💡", chosen: true },
  Other: { emoji: "💬", chosen: true },
  [FEEDBACK_LABEL]: { emoji: "📣", chosen: true },
  [FEEDBACK_AREAS.greeting]: { emoji: "👋", chosen: true },
};

const TITLE_MAX = 80;
/** At most this many from one person per hour, so the form can't flood the list. */
export const FEEDBACK_PER_HOUR = 5;

const COMMIT_URL = "https://github.com/fredrivett/sidetrack/commit/";

/** The first line, cut to a title's length on a word where it can be. */
function titleOf(message: string): string {
  const line = message.split("\n").find((l) => l.trim())?.trim() ?? message;
  if (line.length <= TITLE_MAX) return line;
  const cut = line.slice(0, TITLE_MAX - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > TITLE_MAX / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** An absolute http(s) URL, or null: links from the browser are only kept
 * when they can't be anything else. */
function httpUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

export function submitFeedback(
  db: Db,
  userId: string,
  input: {
    listId: string;
    kind: FeedbackKind;
    message: string;
    /** The page they were on, as a path such as "/board?p=abc". */
    page?: string | null;
    /** The commit their browser was running. */
    release?: string | null;
    /** PostHog session replay and person pages, when PostHog is on. */
    replayUrl?: string | null;
    personUrl?: string | null;
    /**
     * About one part of the app, with a thumbs up or down and what it showed
     * them (the greeting's text). The message is optional then.
     */
    about?: { area: FeedbackArea; rating: FeedbackRating; context: string } | null;
  },
  source: AuditOrigin,
): { itemId: string; ref: string } {
  if (!FEEDBACK_KINDS.includes(input.kind)) throw new Error(`unknown feedback kind: ${input.kind}`);
  const about = input.about ?? null;
  if (
    about &&
    (!Object.hasOwn(FEEDBACK_AREAS, about.area) ||
      !["up", "down"].includes(about.rating) ||
      typeof about.context !== "string")
  ) {
    throw new Error("unknown feedback area or rating");
  }
  const message = input.message.trim();
  if (!message && !about) throw new Error("feedback is empty");
  if ([...message].length > FEEDBACK_MAX) {
    throw new Error(`feedback is too long (max ${FEEDBACK_MAX} characters)`);
  }
  const list = db.select().from(projects).where(eq(projects.id, input.listId)).get();
  if (!list) throw new Error(`feedback list not found: ${input.listId}`);
  const recent = db
    .select({ n: count() })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.actor, userId),
        eq(auditLog.projectId, list.id),
        eq(auditLog.action, "create"),
        eq(auditLog.entityType, "item"),
        gt(auditLog.ts, Date.now() - 60 * 60 * 1000),
      ),
    )
    .get()?.n ?? 0;
  if (recent >= FEEDBACK_PER_HOUR) throw new Error("too much feedback; try again later");

  const reporter = db
    .select({ username: users.username, name: users.name })
    .from(users)
    .where(eq(users.id, userId))
    .get();
  const page = input.page?.startsWith("/") ? input.page.slice(0, 500) : null;
  const release = input.release && /^[0-9a-f]{7,40}$/.test(input.release) ? input.release : null;
  const replay = httpUrl(input.replayUrl);
  const person = httpUrl(input.personUrl);
  const footer = [
    [
      `From ${reporter?.username ? `@${reporter.username}` : (reporter?.name ?? "a deleted user")}`,
      page && `on \`${page}\``,
      release && `build [${release.slice(0, 7)}](${COMMIT_URL}${release})`,
    ],
    [replay && `[replay](${replay})`, person && `[person](${person})`],
  ]
    .map((parts) => parts.filter(Boolean).join(" · "))
    .filter(Boolean);
  footer[1] &&= `PostHog: ${footer[1]}`;
  // What they were rating, quoted as one line: it's their own greeting, but
  // it came from the browser, so it's cut short and can't break the layout.
  const quote = about
    ? `> ${[...about.context.replace(/\s+/g, " ").trim()].slice(0, FEEDBACK_CONTEXT_MAX).join("")}`
    : null;
  const description = [message, quote, `---\n${footer.join("\n")}`].filter(Boolean).join("\n\n");

  const thumb = about ? (about.rating === "up" ? "👍" : "👎") : null;
  const area = about ? FEEDBACK_AREAS[about.area] : null;
  const title = about ? `${thumb} ${area}${message ? `: ${titleOf(message)}` : ""}` : titleOf(message);
  const labels = [KIND_LABELS[input.kind], FEEDBACK_LABEL, ...(area ? [area] : [])];
  const id = nanoid(12);
  // At the top of the list, newest first, as New item adds them.
  const siblings = db
    .select({ id: items.id, position: items.position })
    .from(items)
    .where(and(eq(items.projectId, list.id), isNull(items.parentId)))
    .orderBy(asc(items.position), asc(items.id))
    .all();
  const position = resolvePosition(siblings, "first");

  let number = 0;
  db.transaction((tx) => {
    ensureLabels(tx as unknown as Db, list.id, labels, LABEL_EMOJI);
    number =
      tx
        .update(projects)
        .set({ itemSeq: sql`${projects.itemSeq} + 1` })
        .where(eq(projects.id, list.id))
        .returning({ seq: projects.itemSeq })
        .get()?.seq ?? 1;
    tx.insert(items)
      .values({ id, projectId: list.id, title, description, labels, position, number, createdBy: userId })
      .run();
    recordAudit(tx as unknown as Db, {
      actor: userId,
      source,
      event: {
        type: "item.created",
        itemId: id,
        title,
        projectId: list.id,
        parent: null,
        due: { dueDate: null, dueFrom: null },
        labels,
        assignees: [],
        repeat: null,
      },
    });
  });
  return { itemId: id, ref: formatItemRef(list.prefix, number) };
}
