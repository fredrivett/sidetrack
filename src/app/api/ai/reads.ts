import { z } from "zod";
import { writtenGreetingFor } from "@/core/agendaGreeting";
import { listIconContext } from "@/core/autoEmoji";
import type { Db } from "@/core/db";
import { feedbackFollowUps } from "@/core/feedback";
import { projectRefPrefixes } from "@/core/itemRef";
import { getProject, getProjectWithItems, listProjects, sampleOpenItemTitles } from "@/core/projects";
import { getTimeZone } from "@/core/users";
import { suggestEmoji, suggestLabelEmoji } from "@/lib/emojiSuggest";
import { getEnv } from "@/lib/env";
import { formatItemRef } from "@/lib/itemRef";
import { checkDraftItem, suggestList } from "@/lib/itemSuggest";

// The reads that ask an AI (Jev or Claude), served by /api/ai/[read] rather
// than as Server Actions: Next runs a page's Server Actions one at a time,
// so a read that waits seconds on a model would hold up every save behind
// it. The route checks the request (see route.ts); each read here only says
// what its input is and what it returns. They read and never write, apart
// from the caches they keep for themselves.

interface ReadContext {
  db: Db;
  /** The signed-in user, from the session: never from the request. */
  userId: string;
  /** fetch that gives up once the browser does, for model requests. */
  fetch: typeof fetch;
}

function read<I extends z.ZodType, R>(
  input: I,
  run: (input: z.output<I>, ctx: ReadContext) => Promise<R>,
) {
  return { input, run };
}

// Well beyond anything typed into the app: these only bound what one
// request can make the server hold.
const text = z.string().max(10_000);
const id = z.string().max(100);

export const AI_READS = {
  /**
   * The Agenda greeting: written by Claude when AI is on, otherwise from the
   * templates. Null before their timezone is known. `now` is "Rewrite now";
   * agendaGreeting.ts limits how often one person can make it ask.
   */
  greeting: read(z.object({ now: z.boolean() }), async ({ now }, { db, userId }) => {
    const timeZone = getTimeZone(db, userId);
    if (!timeZone) return null;
    const { TYPESAFE_API_KEY, ANTHROPIC_API_KEY } = getEnv();
    // Not ctx.fetch: it's kept for every tab and the next visit, so it's
    // worth finishing after the browser that asked has gone.
    return writtenGreetingFor(
      db,
      userId,
      timeZone,
      { jev: TYPESAFE_API_KEY, anthropic: ANTHROPIC_API_KEY },
      undefined,
      undefined,
      now,
    );
  }),

  /**
   * Suggestions for an item being written in the New item dialog: the list
   * it fits (when none was chosen), and an open item in that list it repeats
   * or is a step of. Nothing is applied; the dialog shows them.
   */
  newItem: read(
    z.object({ projectId: id.nullable(), title: text, description: text }),
    async (input, ctx) => {
      const { db, userId } = ctx;
      const apiKey = getEnv().TYPESAFE_API_KEY;
      const draft = { title: input.title.trim(), description: input.description.trim() };
      const nothing = { projectId: null, duplicate: null, parent: null };
      if (!apiKey || !draft.title) return nothing;
      let projectId = input.projectId;
      if (!projectId) {
        const titles = sampleOpenItemTitles(db, userId, 10);
        const lists = listProjects(db, userId)
          .filter((p) => p.status === "active")
          .map((p) => ({
            id: p.id,
            name: p.name,
            summary: p.summary,
            itemTitles: titles.get(p.id) ?? [],
          }));
        projectId = await suggestList(draft, lists, apiKey, ctx.fetch);
        if (!projectId) return nothing;
      }
      const found = getProjectWithItems(db, userId, projectId);
      if (!found) return nothing;
      const { duplicateId, parentId } = await checkDraftItem(
        draft,
        found.items.map((it) => ({ id: it.id, title: it.title, topLevel: !it.parentId })),
        apiKey,
        ctx.fetch,
      );
      // The ref as the board shows it: owner-qualified when the prefix clashes.
      const prefix = projectRefPrefixes(db, userId)[projectId] ?? found.project.prefix;
      const hint = (id: string | null) => {
        const it = found.items.find((i) => i.id === id);
        return it ? { id: it.id, ref: formatItemRef(prefix, it.number), title: it.title } : null;
      };
      return { projectId, duplicate: hint(duplicateId), parent: hint(parentId) };
    },
  ),

  /**
   * Icons for a list as it's being written: a saved one (`id`, whose items
   * Jev also reads) or one in the New list dialog. [] when AI is off.
   */
  listIcons: read(
    z.object({ id: id.optional(), name: text, summary: text, homepageUrl: text.nullable() }),
    async ({ id, ...patch }, { db, userId, fetch }) => {
      const apiKey = getEnv().TYPESAFE_API_KEY;
      if (!apiKey || !patch.name.trim()) return [];
      const context = id ? listIconContext(db, userId, id, patch)?.context : { ...patch, itemTitles: [] };
      return context ? suggestEmoji(context, apiKey, fetch) : [];
    },
  ),

  /** Emoji for a label, from its name and its list's, when one is chosen. [] when AI is off. */
  labelEmoji: read(
    z.object({ projectId: id, name: text }),
    async ({ projectId, name }, { db, userId, fetch }) => {
      const apiKey = getEnv().TYPESAFE_API_KEY;
      if (!apiKey || !name.trim()) return [];
      // No list chosen yet is fine (New item); a list they can't see isn't.
      const project = projectId ? getProject(db, userId, projectId) : undefined;
      if (projectId && !project) return [];
      return suggestLabelEmoji({ name: name.trim(), listName: project?.name ?? "" }, apiKey, fetch);
    },
  ),

  /**
   * Claude's follow-up questions about feedback the user just sent, each
   * with likely answers; [] when there's nothing to ask or AI isn't on.
   * Core reads what they sent, and asks once per item.
   */
  feedbackFollowUps: read(z.object({ itemId: id }), async ({ itemId }, { db, userId, fetch }) => {
    const { FEEDBACK_LIST_ID, ANTHROPIC_API_KEY } = getEnv();
    if (!FEEDBACK_LIST_ID) return [];
    return feedbackFollowUps(db, userId, { listId: FEEDBACK_LIST_ID, itemId }, ANTHROPIC_API_KEY, fetch);
  }),
};

export type AiReads = typeof AI_READS;
export type AiReadName = keyof AiReads;
export type AiReadInput<N extends AiReadName> = z.input<AiReads[N]["input"]>;
export type AiReadResult<N extends AiReadName> = Awaited<ReturnType<AiReads[N]["run"]>>;
