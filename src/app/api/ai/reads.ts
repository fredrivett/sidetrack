import { z } from "zod";
import { type Greeting, writtenGreetingFor } from "@/core/agendaGreeting";
import { listIconContext } from "@/core/autoEmoji";
import { getWrapUp } from "@/core/dayWrapUps";
import { listAccessById } from "@/core/access";
import type { Db } from "@/core/db";
import { feedbackFollowUps } from "@/core/feedback";
import { listLabels } from "@/core/labels";
import { type AssigneeView, listAssignees } from "@/core/members";
import { projectRefPrefixes } from "@/core/itemRef";
import { getProject, getProjectWithItems, listProjects, sampleOpenItemTitles } from "@/core/projects";
import { getTimeZone } from "@/core/users";
import { suggestDayTags } from "@/lib/dayTags";
import { suggestEmoji, suggestLabelEmoji } from "@/lib/emojiSuggest";
import { getEnv } from "@/lib/env";
import { formatItemRef } from "@/lib/itemRef";
import { askAboutDraft, type DraftAnswers } from "@/lib/itemSuggest";
import { dayOf, isDay } from "@/lib/time";
import { askTitleParts } from "@/lib/titleParse";

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

/** Someone who can do a task, as the AI reads them: by name, never by email. */
function personName(p: AssigneeView, viewerId: string): string {
  // Never their email: it isn't the AI's to read.
  const name = p.name || p.displayUsername || p.username || "Someone with no name";
  return [name, p.userId === viewerId && "(the person writing this task)"]
    .filter(Boolean)
    .join(" ");
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
    const greeting = await writtenGreetingFor(
      db,
      userId,
      timeZone,
      { jev: TYPESAFE_API_KEY, anthropic: ANTHROPIC_API_KEY },
      undefined,
      undefined,
      now,
    );
    // How today went, once they've closed it, for the panel under it. As
    // it is now, not as the greeting was written.
    const withWrapUp: Greeting = { ...greeting, wrapUp: getWrapUp(db, userId, dayOf(Date.now(), timeZone)) };
    return withWrapUp;
  }),

  /**
   * Suggestions for an item being written in the New item dialog: the list
   * it fits (when none was chosen), an open item in that list it repeats or
   * is a step of, and what to fill in: when it's due, how it repeats, one of
   * the list's labels and who on it does it, and the parts of the title
   * that say any of these (`titleParts`, read by Claude from the viewer's
   * `today`). Nothing is applied; the dialog shows them.
   */
  newItem: read(
    z.object({
      projectId: id.nullable(),
      title: text,
      description: text,
      today: z.string().refine(isDay).nullable().optional(),
    }),
    async (input, ctx) => {
      const { db, userId } = ctx;
      const { TYPESAFE_API_KEY: apiKey, ANTHROPIC_API_KEY } = getEnv();
      const draft = { title: input.title.trim(), description: input.description.trim() };
      const editable = () => {
        const access = listAccessById(db, userId);
        return listProjects(db, userId).filter(
          (p) => p.status === "active" && access.get(p.id) === "edit",
        );
      };
      // Read alongside Jev's answers, so it adds no wait of its own.
      const titleParts =
        ANTHROPIC_API_KEY && input.today && draft.title
          ? askTitleParts(
              draft.title,
              {
                today: input.today,
                lists: editable().map((p) => ({ id: p.id, name: p.name })),
                labels: input.projectId ? listLabels(db, userId, input.projectId).map((l) => l.name) : [],
                people: input.projectId
                  ? listAssignees(db, userId, input.projectId)
                      .filter((a) => a.canEdit)
                      .map((a) => ({ id: a.userId, name: personName(a, userId) }))
                  : [],
              },
              ANTHROPIC_API_KEY,
              ctx.fetch,
            )
          : Promise.resolve([]);
      const [suggestion, parts] = await Promise.all([suggest(), titleParts]);
      return { ...suggestion, titleParts: parts };

      async function suggest() {
        const nothing = {
          projectId: null,
          duplicate: null,
          parent: null,
          due: null,
          repeat: null,
          label: null,
          assigneeId: null,
        };
        if (!apiKey || !draft.title) return nothing;
        let projectId = input.projectId;
        // When it's due and how it repeats don't depend on the list, so
        // they're asked along with the list when there's one to find.
        let timing: Pick<DraftAnswers, "due" | "repeat"> | null = null;
        if (!projectId) {
          const titles = sampleOpenItemTitles(db, userId, 10);
          // Only lists they can add to: not ones they view or comment on.
          const lists = editable()
            .map((p) => ({
              id: p.id,
              name: p.name,
              summary: p.summary,
              itemTitles: titles.get(p.id) ?? [],
            }));
          const found = await askAboutDraft(draft, { lists, timing: true }, apiKey, ctx.fetch);
          timing = { due: found.due, repeat: found.repeat };
          projectId = found.listId;
          if (!projectId) return { ...nothing, ...timing };
        }
        const found = getProjectWithItems(db, userId, projectId);
        if (!found) return { ...nothing, ...timing };
        const labels = listLabels(db, userId, projectId);
        const people = listAssignees(db, userId, projectId).filter((a) => a.canEdit);
        const answers = await askAboutDraft(
          draft,
          {
            items: found.items.map((it) => ({ id: it.id, title: it.title, topLevel: !it.parentId })),
            labels: labels.map((l) => ({ id: l.id, name: l.name })),
            people: people.map((p) => ({ id: p.userId, name: personName(p, userId) })),
            timing: !timing,
          },
          apiKey,
          ctx.fetch,
        );
        // The ref as the board shows it: owner-qualified when the prefix clashes.
        const prefix = projectRefPrefixes(db, userId)[projectId] ?? found.project.prefix;
        const hint = (id: string | null) => {
          const it = found.items.find((i) => i.id === id);
          // Only a top-level item can take sub-items.
          return it
            ? { id: it.id, ref: formatItemRef(prefix, it.number), title: it.title, topLevel: !it.parentId }
            : null;
        };
        return {
          projectId,
          duplicate: hint(answers.duplicateId),
          parent: hint(answers.parentId),
          ...(timing ?? { due: answers.due, repeat: answers.repeat }),
          label: labels.find((l) => l.id === answers.labelId)?.name ?? null,
          assigneeId: answers.assigneeId,
        };
      }
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

  /** The day-note tags that fit what's being typed about today, to suggest. [] when AI is off. */
  dayTags: read(z.object({ text }), async ({ text: typed }, { fetch }) => {
    const apiKey = getEnv().TYPESAFE_API_KEY;
    if (!apiKey || !typed.trim()) return [];
    return suggestDayTags(typed.trim(), apiKey, fetch);
  }),

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
